/** Print step windows for the three Phase B samples. Offline only. */
import { FORMULAS } from '../src/demonstrator/catalog.ts';
import { compileTeachingMotion } from '../src/demonstrator/motion.ts';

const ids = ['gan-f2l-40', 'gan-oll-18', 'gan-oll-12'];
for (const id of ids) {
  const record = FORMULAS.find(item => item.id === id);
  if (!record) throw new Error(`missing ${id}`);
  const program = compileTeachingMotion(record);
  console.log(`\n== ${id} duration ${program.duration.toFixed(3)} steps ${program.steps.length}`);
  for (const step of program.steps) {
    console.log(
      `${String(step.index).padStart(2, ' ')} ${step.move.notation.padEnd(4, ' ')} ${step.start.toFixed(3)}-${step.end.toFixed(3)} ${step.driver.hand}/${step.driver.finger}`,
    );
  }
  for (const relay of program.supportedRelays ?? []) {
    console.log('supportedRelay', JSON.stringify({
      sourceStep: relay.sourceStep,
      start: relay.start,
      ready: relay.ready,
      yieldStart: relay.yieldStart,
      lifted: relay.lifted,
      yielded: relay.yielded,
      arrived: relay.arrived,
      refolded: relay.refolded,
      restored: relay.restored,
      end: relay.end,
    }));
  }
}
