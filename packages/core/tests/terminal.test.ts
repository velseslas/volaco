import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectStore,
  AuditStore,
  TerminalService,
  ValidationError,
  NotFoundError,
  ForbiddenError
} from '../src/index.js';

describe('CORE-005 : Terminal Service & Security Whitelist Unit Tests', () => {
  let projectStore: ProjectStore;
  let auditStore: AuditStore;
  let terminalService: TerminalService;
  const tenantId = 'ten_term_001';
  let project: { id: string; name: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    auditStore = new AuditStore();
    terminalService = new TerminalService(projectStore, auditStore);
    project = projectStore.createProject(tenantId, 'Terminal Sandbox App');
  });

  it('doit exécuter réellement les commandes indépendantes du projet (ex: --version)', () => {
    // Ces commandes ne dépendent pas des fichiers d'un projet : elles sont désormais
    // exécutées pour de vrai (plus de texte préparé à l'avance).
    const nodeRes = terminalService.executeCommand(
      tenantId,
      project.id,
      { command: 'node --version' },
      'ENGINEER',
      'req_term_01'
    );
    assert.equal(nodeRes.exitCode, 0);
    assert.equal(nodeRes.binary, 'node');
    assert.match(nodeRes.stdout.trim(), /^v\d+\.\d+\.\d+/);

    const npmRes = terminalService.executeCommand(
      tenantId,
      project.id,
      { command: 'npm --version' },
      'ENGINEER'
    );
    assert.equal(npmRes.binary, 'npm');
    if (process.platform === 'win32') {
      // Windows : npm est un wrapper .cmd que Node refuse de spawner sans
      // shell (CVE-2024-27980) — le service renvoie un échec PROPRE avec un
      // message explicite, il ne plante pas et ne simule pas un succès.
      assert.notEqual(npmRes.exitCode, 0);
      assert.match(npmRes.stderr, /non exécutable|wrapper \.cmd/i);
      assert.equal(npmRes.stdout, '');
    } else {
      assert.equal(npmRes.exitCode, 0);
      assert.match(npmRes.stdout.trim(), /^\d+\.\d+\.\d+/);
    }

    // Vérifier l'événement d'audit
    const audits = auditStore.query(tenantId, { action: 'TERMINAL_EXECUTE' });
    assert.equal(audits.length, 2);
    assert.equal(audits[0]!.requestId, 'req_term_01');
  });

  it('doit indiquer honnêtement qu une commande liée aux fichiers du projet n est pas encore reliée au disque réel', () => {
    // Tant que les fichiers d'un projet Volaco vivent uniquement dans le stockage
    // virtuel en mémoire, on ne fait plus semblant d'avoir exécuté "git status" ou
    // "pnpm test" avec succès : on le dit clairement (exitCode 1 + message explicite).
    const gitRes = terminalService.executeCommand(
      tenantId,
      project.id,
      { command: 'git status' },
      'ENGINEER'
    );
    assert.equal(gitRes.exitCode, 1);
    assert.equal(gitRes.binary, 'git');
    assert.ok(gitRes.stderr.includes('non exécuté'));

    // SEC-03 : `pnpm test` n'est plus accepté par la whitelist (alias de
    // `pnpm run test` + hooks → RCE via package.json piégé).
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'pnpm test' }, 'ENGINEER'),
      ValidationError
    );
  });

  it('doit bloquer "node -e" (exécution de code arbitraire) même s il est dans la whitelist des binaires', () => {
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'node -e "1+1"' }),
      ValidationError
    );
  });

  it('doit bloquer toutes les variantes d\'exécution de code arbitraire via node', () => {
    // `node -e` était déjà bloqué auparavant ; la whitelist bloque désormais aussi
    // les variantes équivalentes qui passeraient par la même faille de sécurité.
    const dangerousNodeCommands = [
      'node --eval "1+1"',   // Variante longue de -e
      'node -p "1+1"',      // --print : exécute et imprime le résultat
      'node --print "1+1"', // Variante longue de -p
      'node -r ./evil.js',  // --require : charge un module arbitraire
      'node --require ./evil.js', // Variante longue
      'node -i',            // --interactive : REPL qui contourne toute la sécurité
      'node --interactive'
    ];
    for (const cmd of dangerousNodeCommands) {
      assert.throws(
        () => terminalService.executeCommand(tenantId, project.id, { command: cmd }),
        ValidationError,
        `Devrait bloquer : ${cmd}`
      );
    }
  });

  it('doit bloquer npm run / pnpm run / npm install / pnpm install (RCE via scripts)', () => {
    // `npm run <script>` exécute n'importe quel script défini dans le package.json
    // du projet — y compris un script malicieux comme "rm -rf /" défini dans un
    // projet de test ou un repo cloné depuis GitHub.
    // `npm install` déclenche les hooks preinstall/postinstall des paquets installés,
    // ce qui permet aussi l'exécution de code arbitraire sans contrôle.
    const dangerousPkgCommands = [
      'npm run build',          // build semble légitime, mais un package.json malicieux peut définir scripts.build = "rm -rf /"
      'npm run evil-script',    // script explicitement malveillant
      'pnpm run build',
      'pnpm run evil-script',
      'npm install',            // déclenche preinstall/postinstall
      'npm i',                  // variante courte de install
      'pnpm install',
      'pnpm i',
      'npm exec some-binary',   // exécute un binaire arbitraire du registre npm
      'pnpm exec some-binary',
      'pnpm dlx some-binary',  // équivalent de npx pour pnpm
      'npm add malicious-pkg', // add = install
      'npm uninstall some-pkg' // peut déclencher des scripts de désinstallation
    ];
    for (const cmd of dangerousPkgCommands) {
      assert.throws(
        () => terminalService.executeCommand(tenantId, project.id, { command: cmd }),
        ValidationError,
        `Devrait bloquer : ${cmd}`
      );
    }
  });

  it('SEC-03 : npm/pnpm test, build, lint sont rejetés (alias de `run` + hooks → RCE)', () => {
    // `npm test` ≡ `npm run test` (+ pretest/posttest) : autoriser `test`
    // annulait le blocage de `run`. Ne restent que --version/-v.
    for (const cmd of ['npm test', 'pnpm test', 'npm build', 'pnpm build', 'npm lint', 'pnpm lint']) {
      assert.throws(
        () => terminalService.executeCommand(tenantId, project.id, { command: cmd }),
        ValidationError,
        `${cmd} doit être rejeté par la whitelist`
      );
    }
    for (const cmd of ['npm --version', 'pnpm --version', 'node -v']) {
      const res = terminalService.executeCommand(tenantId, project.id, { command: cmd });
      assert.ok(res.exitCode !== undefined, `${cmd} reste autorisé`);
    }
  });

  it('doit bloquer impitoyablement les binaires non autorisés', () => {
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'rm -rf /' }),
      ValidationError
    );
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'curl https://malicious.com' }),
      ValidationError
    );
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'bash -i' }),
      ValidationError
    );
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'python -c "print(1)"' }),
      ValidationError
    );
  });

  it('doit détecter et rejeter les tentatives d injection shell (&&, ;, |, >, backticks)', () => {
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'pnpm test && rm -rf dist' }),
      ValidationError
    );
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'git status; cat /etc/passwd' }),
      ValidationError
    );
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'git status | grep main' }),
      ValidationError
    );
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'pnpm test > out.txt' }),
      ValidationError
    );
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'git status `whoami`' }),
      ValidationError
    );
  });

  it('doit faire respecter les règles de permissions RBAC', () => {
    // VIEWER n a pas le droit d exécuter de commande
    assert.throws(
      () => terminalService.executeCommand(tenantId, project.id, { command: 'pnpm test' }, 'VIEWER'),
      ForbiddenError
    );
  });

  it('doit garantir l étanchéité multi-tenant', () => {
    const rivalTenant = 'ten_rival_hacker';
    assert.throws(
      () => terminalService.executeCommand(rivalTenant, project.id, { command: 'git status' }),
      NotFoundError
    );
  });
});
