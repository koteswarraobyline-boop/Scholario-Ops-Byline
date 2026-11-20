/**
 * Case-insensitive identity of a dependency-register name. Computed here only and stored as
 * registry_components.name_key, so the API's duplicate check and the database's unique
 * constraint compare exactly the same value. PostgreSQL's lower() depends on the database
 * locale (e.g. English_United States.1252 leaves 'İ' unchanged and does not produce final
 * sigma), so it must not be used to decide uniqueness.
 * Upper-then-lower folds ß/SS and σ/ς, NFKC folds compatibility forms (ﬁ, full-width letters).
 */
export const registryNameKey = (name: string): string => name.normalize('NFKC').toUpperCase().toLowerCase();

/**
 * Pairs whose names differ but whose keys do not. Migration 008 backfills name_key with
 * PostgreSQL's lower(), which does not fold these, so the migration can commit and the
 * collision only appears when the application rewrites the key. Returns one short line per pair.
 */
export function registryNameCollisions(rows: ReadonlyArray<{ kind: string; name: string }>): string[] {
  const first = new Map<string, string>();
  const problems: string[] = [];
  for (const row of rows) {
    const key = `${row.kind}\0${registryNameKey(row.name)}`;
    const previous = first.get(key);
    if (previous === undefined) first.set(key, row.name);
    else if (previous !== row.name) problems.push(`${row.kind} "${previous}" and "${row.name}"`);
  }
  return problems;
}
