# Label substrings that indicate a snapshot should include the full HTML
# source alongside the screenshot (used for debugging failures).
#
# Kept in app.core so both app.adapters.base and app.models.job can import
# it without creating a circular dependency between those two packages.
DEBUG_SNAPSHOT_TERMS = (
    "error",
    "failed",
    "failure",
    "timeout",
    "not_found",
    "did_not_open",
    "did_not_update",
    "validation",
)
