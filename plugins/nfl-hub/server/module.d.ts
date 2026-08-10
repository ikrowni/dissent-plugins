declare module "main" {
  export function run(): I32;
}

// ⚠️ EVERY HOST FUNCTION THE MODULE CALLS MUST BE DECLARED HERE. Host.getFunctions()
// resolves against this file, so an SDK call to a function missing from this list
// dies at runtime with "not a function" — and, worse, can make a test pass for the
// wrong reason by trapping before the thing under test is ever reached. That
// happened during the CAS work on 2026-08-09.
//
// Keep in step with hostFunctions() in
// dissent-core/internal/pluginruntime/hostfns.go.
declare module "extism:host" {
  interface user {
    host_log(ptr: I64): I64;
    host_caller(ptr: I64): I64;
    host_secret_get(ptr: I64): I64;
    host_storage_get(ptr: I64): I64;
    host_storage_set(ptr: I64): I64;
    host_storage_list(ptr: I64): I64;
    host_storage_get_versioned(ptr: I64): I64;
    host_storage_cas(ptr: I64): I64;
    host_fetch(ptr: I64): I64;
    host_post(ptr: I64): I64;
  }
}
