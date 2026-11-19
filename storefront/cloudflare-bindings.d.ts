// This starter supports an optional DB binding; the current Site does not use it.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}
