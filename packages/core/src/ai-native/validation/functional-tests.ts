/**
 * V7-LOT8 — tests fonctionnels générés à partir du DOM réel.
 *
 * Ce module ne simule pas des scénarios : il observe le document candidat
 * (boutons, formulaires requis, noms accessibles) puis exécute des scénarios
 * déterministes dans le même Chromium isolé que le sandbox navigateur.
 *
 * Politique :
 * - seuls les défauts intrinsèques et reproductibles bloquent (erreur JS après
 *   un clic, page non réactive, champ requis ignoré) ;
 * - les noms accessibles manquants, les formulaires `novalidate` et les
 *   validations natives non satisfaites par les valeurs de test sont des WARN ;
 * - une soumission réelle de formulaire n'est pas déclenchée : la validation
 *   native est vérifiée sans navigation ;
 * - le réseau reste coupé et les liens externes ne sont jamais suivis.
 *
 * Limite assumée : la génération est déterministe à partir du DOM, pas une
 * génération LLM de scénarios métier. Elle prouve les interactions de base,
 * pas la conformité fonctionnelle complète au brief.
 */

import type { Page } from 'playwright-core';

export type BrowserFunctionalTestStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
export type BrowserFunctionalTestsVerdict =
  | 'PASS'
  | 'PASS_WITH_WARNINGS'
  | 'FAIL'
  | 'SKIPPED'
  | 'UNAVAILABLE';

export interface BrowserFunctionalTestScenario {
  readonly id: string;
  readonly name: string;
  readonly kind: 'LOAD' | 'A11Y' | 'INTERACTION' | 'FORM';
  readonly status: BrowserFunctionalTestStatus;
  readonly blocking: boolean;
  readonly durationMs: number;
  readonly message?: string | undefined;
  readonly evidence?: string | undefined;
}

export interface BrowserFunctionalTestPlanSummary {
  readonly buttons: number;
  readonly forms: number;
  readonly requiredForms: number;
  readonly interactiveElements: number;
  readonly missingNames: number;
}

export interface BrowserFunctionalTestsReport {
  readonly schemaVersion: '1.0.0';
  readonly verdict: BrowserFunctionalTestsVerdict;
  readonly passed: boolean;
  readonly blocking: boolean;
  readonly total: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly warningCount: number;
  readonly skippedCount: number;
  readonly durationMs: number;
  readonly scenarios: readonly BrowserFunctionalTestScenario[];
  readonly notes: readonly string[];
  readonly plan: BrowserFunctionalTestPlanSummary;
  readonly generatedFrom: 'DOM';
  readonly checkedAt: string;
}

export interface BrowserFunctionalTestsOptions {
  readonly timeoutMs?: number | undefined;
  readonly maxClickTests?: number | undefined;
  /**
   * Quand un script externe a été bloqué, une ReferenceError peut être causée
   * par le CDN absent : elle est alors dégradée en WARN, comme dans le runtime.
   */
  readonly downgradeExternalDependencyErrors?: boolean | undefined;
}

interface PlannedButton {
  readonly index: number;
  readonly label: string;
  readonly type: string;
  readonly inForm: boolean;
  readonly visible: boolean;
  readonly disabled: boolean;
}

interface PlannedForm {
  readonly index: number;
  readonly requiredCount: number;
  readonly novalidate: boolean;
  readonly submitLabel: string;
}

export interface FunctionalTestPlan {
  readonly title: string;
  readonly headingCount: number;
  readonly linkCount: number;
  readonly interactiveCount: number;
  readonly visibleTextLength: number;
  readonly missingNames: readonly string[];
  readonly buttons: readonly PlannedButton[];
  readonly forms: readonly PlannedForm[];
}

export const DEFAULT_MAX_CLICK_TESTS = 5;
export const MAX_FUNCTIONAL_FORMS = 3;

const MAX_SCENARIO_MESSAGE = 800;

/**
 * Script exécuté DANS Chromium. Il marque les éléments pour que les scénarios
 * puissent les retrouver après chaque réinitialisation du document.
 */
const PLAN_SCRIPT = String.raw`(() => {
  const textOf = (el) => {
    const raw = (el && (el.innerText || el.textContent)) || '';
    return String(raw).replace(/\s+/g, ' ').trim().slice(0, 100);
  };
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' &&
      Number(style.opacity || '1') > 0;
  };
  const accessibleName = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const joined = labelledBy.split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => textOf(node))
        .join(' ')
        .trim();
      if (joined) return joined;
    }
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const labels = el.labels
        ? Array.from(el.labels).map((node) => textOf(node)).join(' ').trim()
        : '';
      if (labels) return labels;
      const placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();
      const name = el.getAttribute('name');
      if (name && name.trim()) return name.trim();
      if (tag === 'input' && (el.type || '').toLowerCase() !== 'password') {
        const value = el.getAttribute('value');
        if (value && value.trim()) return value.trim();
      }
    }
    const own = textOf(el);
    if (own) return own;
    const image = el.querySelector('img[alt]');
    if (image && image.getAttribute('alt') && image.getAttribute('alt').trim()) {
      return image.getAttribute('alt').trim();
    }
    return '';
  };

  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  buttons.forEach((el, index) => el.setAttribute('data-volaco-ft', String(index)));
  const forms = Array.from(document.querySelectorAll('form'));
  forms.forEach((el, index) => el.setAttribute('data-volaco-ft-form', String(index)));

  const interactive = Array.from(document.querySelectorAll(
    'a[href], button, input, select, textarea, [role="button"], [onclick]'
  ));
  const missingNames = interactive
    .filter((el) => visible(el) && !accessibleName(el))
    .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''))
    .slice(0, 8);

  return {
    title: typeof document.title === 'string' ? document.title : '',
    headingCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    linkCount: document.querySelectorAll('a[href]').length,
    interactiveCount: interactive.length,
    visibleTextLength: document.body && typeof document.body.innerText === 'string'
      ? document.body.innerText.trim().length
      : 0,
    missingNames,
    buttons: buttons.map((el, index) => ({
      index,
      label: accessibleName(el) || ('bouton #' + (index + 1)),
      type: (el.getAttribute('type') || (el.tagName === 'BUTTON' ? 'submit' : 'button')).toLowerCase(),
      inForm: Boolean(el.closest('form')),
      visible: visible(el),
      disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true'
    })),
    forms: forms.map((el, index) => {
      const required = el.querySelectorAll('input[required], select[required], textarea[required]');
      const submit = el.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      return {
        index,
        requiredCount: required.length,
        novalidate: el.hasAttribute('novalidate'),
        submitLabel: submit ? (accessibleName(submit) || 'soumettre') : 'soumettre'
      };
    })
  };
})()`;

const MARK_SCRIPT = String.raw`(() => {
  document.querySelectorAll('button, [role="button"]').forEach((el, index) => {
    el.setAttribute('data-volaco-ft', String(index));
  });
  document.querySelectorAll('form').forEach((el, index) => {
    el.setAttribute('data-volaco-ft-form', String(index));
  });
  return true;
})()`;

/**
 * Vérifie la validation native d'un formulaire requis sans le soumettre.
 * Les valeurs de test sont génériques ; un refus de validation est un WARN,
 * pas une preuve de bug métier.
 */
const FORM_CHECK_SCRIPT = String.raw`(() => {
  const index = __INDEX__;
  const form = document.querySelector('[data-volaco-ft-form="' + index + '"]');
  if (!form) return { found: false };

  const required = Array.from(form.querySelectorAll('input[required], select[required], textarea[required]'));
  const isEmpty = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return !el.checked;
    }
    return !String(el.value || '').trim();
  };
  const hasEmptyRequired = required.some(isEmpty);
  const emptyValid = form.checkValidity();

  for (const el of required) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') el.checked = true;
      else if (type === 'file') {
        // Un input file ne peut pas être rempli par script ; la validation
        // restera probablement invalide et sera rapportée en WARN.
      }
      else if (type === 'email') el.value = 'test@example.com';
      else if (type === 'url') el.value = 'https://example.com';
      else if (type === 'number') el.value = '1';
      else if (type === 'date') el.value = '2026-01-01';
      else if (type === 'password') el.value = 'Test1234!';
      else el.value = 'test';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (tag === 'select') {
      const option = Array.from(el.options).find((opt) => !opt.disabled && String(opt.value) !== '') || el.options[0];
      if (option) {
        el.value = option.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      el.value = 'test';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  return {
    found: true,
    requiredCount: required.length,
    hasEmptyRequired,
    emptyValid,
    filledValid: form.checkValidity()
  };
})()`;

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function normalizePlan(raw: unknown): FunctionalTestPlan {
  const value = toRecord(raw);
  if (!value) throw new Error('Plan de tests fonctionnels invalide.');

  const buttons: PlannedButton[] = [];
  if (Array.isArray(value.buttons)) {
    value.buttons.forEach((item, index) => {
      const button = toRecord(item);
      if (!button) return;
      buttons.push({
        index: Number.isFinite(Number(button.index)) ? Number(button.index) : index,
        label: typeof button.label === 'string' && button.label.trim()
          ? button.label.trim().slice(0, 120)
          : `bouton #${index + 1}`,
        type: typeof button.type === 'string' ? button.type.toLowerCase() : 'button',
        inForm: button.inForm === true,
        visible: button.visible === true,
        disabled: button.disabled === true
      });
    });
  }

  const forms: PlannedForm[] = [];
  if (Array.isArray(value.forms)) {
    value.forms.forEach((item, index) => {
      const form = toRecord(item);
      if (!form) return;
      forms.push({
        index: Number.isFinite(Number(form.index)) ? Number(form.index) : index,
        requiredCount: Math.max(0, Number(form.requiredCount) || 0),
        novalidate: form.novalidate === true,
        submitLabel: typeof form.submitLabel === 'string' && form.submitLabel.trim()
          ? form.submitLabel.trim().slice(0, 120)
          : 'soumettre'
      });
    });
  }

  const missingNames = Array.isArray(value.missingNames)
    ? value.missingNames
      .filter((item): item is string => typeof item === 'string')
      .slice(0, 8)
    : [];

  return {
    title: typeof value.title === 'string' ? value.title : '',
    headingCount: Math.max(0, Number(value.headingCount) || 0),
    linkCount: Math.max(0, Number(value.linkCount) || 0),
    interactiveCount: Math.max(0, Number(value.interactiveCount) || 0),
    visibleTextLength: Math.max(0, Number(value.visibleTextLength) || 0),
    missingNames,
    buttons,
    forms
  };
}

export async function generateFunctionalTestPlan(page: Page): Promise<FunctionalTestPlan> {
  const raw = await page.evaluate(PLAN_SCRIPT);
  return normalizePlan(raw);
}

function makeScenario(
  id: string,
  name: string,
  kind: BrowserFunctionalTestScenario['kind'],
  status: BrowserFunctionalTestStatus,
  startedAt: number,
  message?: string | undefined,
  evidence?: string | undefined
): BrowserFunctionalTestScenario {
  return {
    id,
    name,
    kind,
    status,
    blocking: status === 'FAIL',
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(message ? { message: message.slice(0, MAX_SCENARIO_MESSAGE) } : {}),
    ...(evidence ? { evidence: evidence.slice(0, 160) } : {})
  };
}

function buildReport(
  scenarios: readonly BrowserFunctionalTestScenario[],
  notes: readonly string[],
  plan: FunctionalTestPlan,
  startedAt: number
): BrowserFunctionalTestsReport {
  const failedCount = scenarios.filter((scenario) => scenario.status === 'FAIL').length;
  const warningCount = scenarios.filter((scenario) => scenario.status === 'WARN').length;
  const skippedCount = scenarios.filter((scenario) => scenario.status === 'SKIP').length;
  const passedCount = scenarios.filter((scenario) => scenario.status === 'PASS').length;
  const blocking = failedCount > 0;
  const verdict: BrowserFunctionalTestsVerdict = blocking
    ? 'FAIL'
    : warningCount > 0
      ? 'PASS_WITH_WARNINGS'
      : 'PASS';

  return {
    schemaVersion: '1.0.0',
    verdict,
    passed: !blocking,
    blocking,
    total: scenarios.length,
    passedCount,
    failedCount,
    warningCount,
    skippedCount,
    durationMs: Math.max(0, Date.now() - startedAt),
    scenarios,
    notes,
    plan: {
      buttons: plan.buttons.length,
      forms: plan.forms.length,
      requiredForms: plan.forms.filter((form) => form.requiredCount > 0).length,
      interactiveElements: plan.interactiveCount,
      missingNames: plan.missingNames.length
    },
    generatedFrom: 'DOM',
    checkedAt: new Date().toISOString()
  };
}

export function skippedFunctionalTestsReport(reason: string): BrowserFunctionalTestsReport {
  return {
    schemaVersion: '1.0.0',
    verdict: 'SKIPPED',
    passed: false,
    blocking: false,
    total: 0,
    passedCount: 0,
    failedCount: 0,
    warningCount: 0,
    skippedCount: 0,
    durationMs: 0,
    scenarios: [],
    notes: [reason.slice(0, MAX_SCENARIO_MESSAGE)],
    plan: { buttons: 0, forms: 0, requiredForms: 0, interactiveElements: 0, missingNames: 0 },
    generatedFrom: 'DOM',
    checkedAt: new Date().toISOString()
  };
}

export function unavailableFunctionalTestsReport(reason: string): BrowserFunctionalTestsReport {
  return {
    ...skippedFunctionalTestsReport(reason),
    verdict: 'UNAVAILABLE',
    passed: false,
    blocking: false
  };
}

function isExternalDependencyError(text: string): boolean {
  return /ReferenceError|is not defined/i.test(text);
}

function hardErrors(
  errors: readonly string[],
  downgradeExternalDependencyErrors: boolean
): readonly string[] {
  return downgradeExternalDependencyErrors
    ? errors.filter((error) => !isExternalDependencyError(error))
    : errors;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runClickScenario(
  page: Page,
  html: string,
  button: PlannedButton,
  options: BrowserFunctionalTestsOptions
): Promise<BrowserFunctionalTestScenario> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(500, options.timeoutMs ?? 5000);
  const id = `click-${button.index}`;
  const name = `Clic sur « ${button.label} »`;
  const errors: string[] = [];
  const handler = (error: Error) => {
    if (errors.length >= 5) return;
    errors.push(`${error.name || 'Error'}: ${error.message}`.slice(0, 500));
  };
  page.on('pageerror', handler);

  try {
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForTimeout(200);
    // Les erreurs de chargement ont déjà été jugées par le runtime ; on ne
    // retient que celles déclenchées par l'interaction.
    errors.length = 0;
    await page.evaluate(MARK_SCRIPT);

    const locator = page.locator(`[data-volaco-ft="${button.index}"]`).first();
    if (await locator.count() === 0) {
      return makeScenario(id, name, 'INTERACTION', 'WARN', startedAt,
        'Bouton introuvable après réinitialisation du document.', button.label);
    }

    try {
      await locator.click({ timeout: Math.min(timeoutMs, 2000) });
    } catch (err) {
      await page.waitForTimeout(100);
      const hard = hardErrors(errors, options.downgradeExternalDependencyErrors === true);
      if (hard.length > 0) {
        return makeScenario(id, name, 'INTERACTION', 'FAIL', startedAt,
          `Erreur JavaScript après clic : ${hard.join(' | ')}`, button.label);
      }
      if (errors.length > 0) {
        return makeScenario(id, name, 'INTERACTION', 'WARN', startedAt,
          `Erreur possiblement liée à une dépendance externe bloquée : ${errors.join(' | ')}`,
          button.label);
      }
      return makeScenario(id, name, 'INTERACTION', 'WARN', startedAt,
        `Clic non vérifiable (navigation, overlay ou timeout) : ${err instanceof Error ? err.message : String(err)}`,
        button.label);
    }

    await page.waitForTimeout(150);
    const hard = hardErrors(errors, options.downgradeExternalDependencyErrors === true);
    if (hard.length > 0) {
      return makeScenario(id, name, 'INTERACTION', 'FAIL', startedAt,
        `Erreur JavaScript après clic : ${hard.join(' | ')}`, button.label);
    }
    if (errors.length > 0) {
      return makeScenario(id, name, 'INTERACTION', 'WARN', startedAt,
        `Erreur possiblement liée à une dépendance externe bloquée : ${errors.join(' | ')}`,
        button.label);
    }

    const responsive = await withTimeout(page.evaluate(() => true), 1000, false);
    if (!responsive) {
      return makeScenario(id, name, 'INTERACTION', 'FAIL', startedAt,
        'Page non réactive après le clic (timeout).', button.label);
    }

    return makeScenario(id, name, 'INTERACTION', 'PASS', startedAt, undefined, button.label);
  } catch (err) {
    // Le runtime a déjà jugé le chargement initial. Un reset impossible, une
    // navigation ou un contexte détruit ne prouve pas un défaut du document :
    // le scénario est non concluant, jamais bloquant.
    return makeScenario(id, name, 'INTERACTION', 'WARN', startedAt,
      `Scénario non exécuté (réinitialisation ou navigation) : ${err instanceof Error ? err.message : String(err)}`,
      button.label);
  } finally {
    page.off('pageerror', handler);
  }
}

async function runFormScenario(
  page: Page,
  html: string,
  form: PlannedForm,
  options: BrowserFunctionalTestsOptions
): Promise<BrowserFunctionalTestScenario> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(500, options.timeoutMs ?? 5000);
  const id = `form-${form.index}`;
  const name = `Validation du formulaire « ${form.submitLabel} »`;

  if (form.novalidate) {
    return makeScenario(id, name, 'FORM', 'WARN', startedAt,
      'Formulaire novalidate : validation native désactivée, scénario non concluant.',
      form.submitLabel);
  }

  const errors: string[] = [];
  const handler = (error: Error) => {
    if (errors.length >= 5) return;
    errors.push(`${error.name || 'Error'}: ${error.message}`.slice(0, 500));
  };
  page.on('pageerror', handler);

  try {
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForTimeout(200);
    errors.length = 0;
    await page.evaluate(MARK_SCRIPT);

    const result = await page.evaluate(
      FORM_CHECK_SCRIPT.replace('__INDEX__', String(form.index))
    ) as {
      found?: boolean;
      requiredCount?: number;
      hasEmptyRequired?: boolean;
      emptyValid?: boolean;
      filledValid?: boolean;
    };

    const hard = hardErrors(errors, options.downgradeExternalDependencyErrors === true);
    if (hard.length > 0) {
      return makeScenario(id, name, 'FORM', 'FAIL', startedAt,
        `Erreur JavaScript pendant la validation : ${hard.join(' | ')}`, form.submitLabel);
    }
    if (!result || result.found !== true) {
      return makeScenario(id, name, 'FORM', 'WARN', startedAt,
        'Formulaire introuvable après réinitialisation du document.', form.submitLabel);
    }
    if (result.hasEmptyRequired === true && result.emptyValid === true) {
      return makeScenario(id, name, 'FORM', 'FAIL', startedAt,
        'Champs requis ignorés : le formulaire est valide alors que des champs requis sont vides.',
        form.submitLabel);
    }
    if (result.filledValid !== true) {
      return makeScenario(id, name, 'FORM', 'WARN', startedAt,
        'La validation native refuse les valeurs de test génériques (pattern métier probable).',
        form.submitLabel);
    }
    return makeScenario(id, name, 'FORM', 'PASS', startedAt, undefined, form.submitLabel);
  } catch (err) {
    return makeScenario(id, name, 'FORM', 'WARN', startedAt,
      `Validation du formulaire non exécutée : ${err instanceof Error ? err.message : String(err)}`,
      form.submitLabel);
  } finally {
    page.off('pageerror', handler);
  }
}

/**
 * Exécute les scénarios générés sur la page fournie. Le document est
 * réinitialisé entre chaque scénario ; le réseau reste coupé par le contexte.
 */
export async function runGeneratedFunctionalTests(
  page: Page,
  html: string,
  plan: FunctionalTestPlan,
  options: BrowserFunctionalTestsOptions = {}
): Promise<BrowserFunctionalTestsReport> {
  const startedAt = Date.now();
  const maxClickTests = Math.max(0, options.maxClickTests ?? DEFAULT_MAX_CLICK_TESTS);
  const scenarios: BrowserFunctionalTestScenario[] = [];
  const notes: string[] = [
    'Scénarios générés de façon déterministe à partir du DOM réel (chargement, noms accessibles, boutons, formulaires requis).',
    'Aucune soumission de formulaire réelle : validation native uniquement.',
    'Réseau coupé : les liens externes ne sont pas suivis.'
  ];

  const loadStartedAt = Date.now();
  const loadOk = plan.visibleTextLength >= 10 || plan.headingCount > 0 || plan.title.trim().length > 0;
  scenarios.push(makeScenario(
    'load',
    'Chargement et contenu du document',
    'LOAD',
    loadOk ? 'PASS' : 'WARN',
    loadStartedAt,
    loadOk ? undefined : 'Document chargé mais sans titre, texte ou titre structurant suffisant.'
  ));

  const a11yStartedAt = Date.now();
  scenarios.push(makeScenario(
    'a11y',
    'Noms accessibles des éléments interactifs',
    'A11Y',
    plan.missingNames.length > 0 ? 'WARN' : 'PASS',
    a11yStartedAt,
    plan.missingNames.length > 0
      ? `${plan.missingNames.length} élément(s) sans nom accessible : ${plan.missingNames.join(', ')}`
      : undefined
  ));

  const clickable = plan.buttons.filter((button) =>
    button.visible &&
    !button.disabled &&
    !(button.inForm && button.type === 'submit')
  );
  const selectedButtons = clickable.slice(0, maxClickTests);
  if (clickable.length > selectedButtons.length) {
    scenarios.push(makeScenario(
      'coverage-buttons',
      'Couverture des boutons',
      'INTERACTION',
      'WARN',
      Date.now(),
      `${clickable.length - selectedButtons.length} bouton(s) non testé(s) (limite ${maxClickTests}).`
    ));
  }
  if (selectedButtons.length === 0) {
    scenarios.push(makeScenario(
      'interaction-none',
      'Aucun bouton cliquable',
      'INTERACTION',
      'SKIP',
      Date.now(),
      'Aucun bouton visible et activé hors soumission de formulaire.'
    ));
  }
  for (const button of selectedButtons) {
    const scenario = await runClickScenario(page, html, button, options);
    scenarios.push(scenario);
    if (scenario.blocking) {
      notes.push('Tests suivants interrompus après un échec bloquant.');
      return buildReport(scenarios, notes, plan, startedAt);
    }
  }

  const requiredForms = plan.forms.filter((form) => form.requiredCount > 0);
  const selectedForms = requiredForms.slice(0, MAX_FUNCTIONAL_FORMS);
  if (requiredForms.length > selectedForms.length) {
    scenarios.push(makeScenario(
      'coverage-forms',
      'Couverture des formulaires',
      'FORM',
      'WARN',
      Date.now(),
      `${requiredForms.length - selectedForms.length} formulaire(s) non testé(s) (limite ${MAX_FUNCTIONAL_FORMS}).`
    ));
  }
  if (selectedForms.length === 0) {
    scenarios.push(makeScenario(
      'form-none',
      'Aucun formulaire requis',
      'FORM',
      'SKIP',
      Date.now(),
      'Aucun formulaire avec champ requis.'
    ));
  }
  for (const form of selectedForms) {
    const scenario = await runFormScenario(page, html, form, options);
    scenarios.push(scenario);
    if (scenario.blocking) {
      notes.push('Tests suivants interrompus après un échec bloquant.');
      break;
    }
  }

  return buildReport(scenarios, notes, plan, startedAt);
}
