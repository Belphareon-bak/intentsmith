# Studio runtime cancellation and bounded multi-file draft input

Authority: explicit operator instruction to continue production work in parallel;
PRODUCT §3 visible proposal, approval and cancellation, and accepted
WP-M2-LIFECYCLE-V1 cancellation during the focused test. Review of source
`8f9fb230009e44de528a5df62ce63f43234fa08e` reproduced that Studio's busy guard
suppresses `/m2-cancel` while the approval HTTP request owns the running test.

One writer in the existing owned `model-spec6000` checkout, branch
`work/studio-runtime-cancel-20260911`. Owned implementation paths: the
hand-maintained chat-panel browser module and its existing Studio surface test.
Root integrates backend work and owns canonical inventories and final builds.

Deliver one exact durable cancel request while approval is running, retain the
authenticated origin, and keep request completion ordering from reopening a
terminal plan or clearing another request's busy state. Do not abort approval
transport as a substitute for durable cancellation. Also accept comma-separated
two or three explicit draft paths through the unchanged draft endpoint;
single-path input remains compatible. Backend remains the schema authority.

Verify the real browser dispatcher in a VM with both HTTP completion orders,
duplicate cancel, failure and stale-origin cases, plus multi-file serialization.
No model, production DB, authority contract or GPU changes. Independent
acceptance and full product build remain integration work, not a claim here.
