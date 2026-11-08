// Resolve the API from the current app origin.
// This keeps web clients working when Back4app rotates temporary URLs.
window.MIGOLIVE_API_BASE = window.MIGOLIVE_API_BASE || (window.location.origin + "/api");
