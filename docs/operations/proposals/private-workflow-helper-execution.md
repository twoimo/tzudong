# Private workflow helper execution proposal

This unexecuted operating migration was investigated in an isolated clone. It restores six helper EXECUTEs to the shared private workflow owner and narrows G014 exceptions for three signatures. The experiment also tightened the private administrator predicate.

It is not adopted into the executable source migration inventory. Full-schema action tests subsequently found missing DML privileges and obsolete `name`, `unique_id`, and `resource_type` references in the inherited approval routines. Restoring permissions alone cannot preserve current-schema behavior and also revives seven additional legacy paths.

The selected implementation keeps approval writes in the existing guarded, service-only atomic action, using current schema helpers, active-actor validation, CAS, minimized audit and readback. The draft and its positive/negative observations remain historical evidence; they do not authorize operating grants or advertise a working legacy route.
