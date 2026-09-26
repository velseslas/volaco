const assert = require('assert');
const { AgentPlanner } = require('./dist/packages/core/src/ai-native/agent-runtime/planning/planner.js');
const { PlanValidator } = require('./dist/packages/core/src/ai-native/agent-runtime/planning/validator.js');
const { SurgicalActionSequencer } = require('./dist/packages/core/src/ai-native/agent-runtime/planning/action-sequencer.js');
const { FORBIDDEN_PLAN_WORDS, SURGICAL_ACTION_PRIMITIVES } = require('./dist/packages/core/src/ai-native/agent-runtime/planning/prompts.js');
const { PlanGenerator } = require('./dist/packages/core/src/ai-native/conversation-intelligence/engine/plan-generator.js');

console.log('=== TEST 1: AgentPlanner.createSurgicalPlan (Boulangerie) ===');
const planner = new AgentPlanner();
const bakeryPlan = planner.createSurgicalPlan('Créer un site de boulangerie');

console.log('Title:', bakeryPlan.title);
console.log('Stack:', bakeryPlan.stack);
assert.ok(bakeryPlan.title.includes('Boulangerie'));
assert.deepStrictEqual(bakeryPlan.stack, ['lucide-react', 'framer-motion', 'clsx', 'tailwind-merge']);
assert.strictEqual(bakeryPlan.steps.length, 6);

bakeryPlan.steps.forEach((step, idx) => {
  console.log(`  Step ${step.id}: [${step.action}] ${step.target_file} | Symbols: ${JSON.stringify(step.symbols)} | Summary: "${step.summary}"`);
  assert.ok(SURGICAL_ACTION_PRIMITIVES.includes(step.action), `Invalid primitive: ${step.action}`);
  assert.ok(step.target_file && step.target_file.length > 0, `Empty target_file in step ${step.id}`);
  assert.ok(Array.isArray(step.symbols), `Symbols must be array in step ${step.id}`);
  assert.ok(step.summary && step.summary.length > 0, `Empty summary in step ${step.id}`);
  const wordCount = step.summary.trim().split(/\s+/).length;
  assert.ok(wordCount <= 10, `Summary exceeds 10 words (${wordCount}): "${step.summary}"`);
  
  // Check no forbidden words
  const lower = (step.summary + ' ' + step.target_file + ' ' + bakeryPlan.title).toLowerCase();
  for (const fw of FORBIDDEN_PLAN_WORDS) {
    assert.ok(!lower.includes(fw), `Forbidden word '${fw}' found in step ${step.id}!`);
  }
});
console.log('✓ TEST 1 PASSED: Bakery surgical plan is 100% compliant.\n');

console.log('=== TEST 2: Strict Rejection of Forbidden Abstract Words ===');
const validator = new PlanValidator();

const forbiddenTests = [
  'Analyser les besoins du client',
  'Concevoir une architecture scalable',
  'Développer les composants front',
  'Préparer le déploiement',
  'Étudier le périmètre',
  'Tester la cohérence applicative',
  'Valider les exigences'
];

forbiddenTests.forEach((badSummary, i) => {
  assert.throws(() => {
    validator.validateSurgicalPlan({
      title: 'Valid Plan Title',
      stack: ['react'],
      steps: [
        {
          id: 1,
          action: 'create',
          target_file: 'src/components/Test.tsx',
          symbols: ['Test'],
          summary: badSummary
        }
      ]
    });
  }, (err) => {
    return err.name === 'PlanValidationError' || String(err).includes('interdit') || String(err).includes('abstrait');
  }, `Should have rejected forbidden summary: "${badSummary}"`);
});
console.log('✓ TEST 2 PASSED: All forbidden consultant words are strictly rejected.\n');

console.log('=== TEST 3: Max 10 Words Limit Enforcement ===');
assert.throws(() => {
  validator.validateSurgicalPlan({
    title: 'Valid Plan Title',
    stack: ['react'],
    steps: [
      {
        id: 1,
        action: 'create',
        target_file: 'src/components/Long.tsx',
        symbols: ['Long'],
        summary: 'Ceci est une description technique beaucoup trop longue comportant plus de dix mots interdits'
      }
    ]
  });
}, (err) => {
  return String(err).includes('10 mots') || String(err).includes('limite');
}, 'Should have rejected summary exceeding 10 words');
console.log('✓ TEST 3 PASSED: 10-word limit strictly enforced.\n');

console.log('=== TEST 4: PlanGenerator (Conversation Intelligence) Bakery Plan ===');
const gen = new PlanGenerator();
const ciPlan = gen.generatePlan({
  intent: {
    category: 'CREATE',
    goal: 'Créer un site de boulangerie',
    requestedAction: 'CREATE site de boulangerie',
    entities: ['boulangerie'],
    constraints: [],
    urgency: 'NORMAL',
    confidence: 0.95,
    ambiguities: []
  }
});

console.log('CI Plan Title:', ciPlan.title);
console.log('CI Plan Stack:', ciPlan.stack);
assert.ok(ciPlan.title.includes('Boulangerie'));
assert.deepStrictEqual(ciPlan.stack, ['lucide-react', 'framer-motion', 'clsx', 'tailwind-merge']);
assert.strictEqual(ciPlan.steps.length, 6);

ciPlan.steps.forEach((s) => {
  console.log(`  CI Step ${s.order}: [${s.action}] ${s.target_file} -> "${s.summary}"`);
  assert.ok(['install', 'create', 'edit', 'verify'].includes(s.action));
  assert.ok(s.summary.split(/\s+/).length <= 10);
});
console.log('✓ TEST 4 PASSED: Conversation Intelligence PlanGenerator adheres to surgical plan standard.\n');

console.log('ALL SURGICAL PLAN TESTS PASSED SUCCESSFULLY!');
