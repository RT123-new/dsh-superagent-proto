# Launch scheduling wait review

Atomic additions: red1129d39/fix2955934, full1440/1440, typecheck/build pass.

Slot wait imports a3aad17 as524d667, independent red3f83431, integrator clock/dispose red4b42ac4/fixf675f71 reused locally as94b462a/7a38993. Narrow remaining repair stamps after commit, and removes stopped-assignment stamps after commit so rollback preserves a committed pending stamp. Emits launch_slot_wait, retaining the old allowed stage for compatibility. This is committed first enqueue to successful reservation, including scheduling, pause and denial/retry delay, not isolated capacity contention. No pre-restart timestamps are invented. Original tests exercise pre-launch seam only; new Runtime fixture additionally proves running assignment and recorded metric with injected clock, enqueue rollback and stop rollback. No scheduler/free/kick changes.

Before importing integrator fix, equivalent complete local repair full1446/1446 across94files and build/typecheck passed. With reused fix and additional stop rollback, focused8/8 pass. Final whole-suite rerun follows. Dashboard translation for new launch_slot_wait stage remains for UI owner; do not label it pure worker-capacity wait.
