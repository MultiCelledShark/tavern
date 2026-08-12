import { MODULES, ModuleType } from "../api/client";

export const MODULE_ORDER_STORAGE_KEY = "tavern.workspace.moduleOrder";

const DEFAULT_ORDER: ModuleType[] = MODULES.map((m) => m.id);

export function loadModuleOrder(): ModuleType[] {
  try {
    const raw = localStorage.getItem(MODULE_ORDER_STORAGE_KEY);
    if (!raw) return [...DEFAULT_ORDER];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_ORDER];
    const known = new Set(DEFAULT_ORDER);
    const seen = new Set<ModuleType>();
    const ordered: ModuleType[] = [];
    for (const id of parsed) {
      if (typeof id !== "string" || !known.has(id as ModuleType)) continue;
      const mid = id as ModuleType;
      if (seen.has(mid)) continue;
      seen.add(mid);
      ordered.push(mid);
    }
    for (const id of DEFAULT_ORDER) {
      if (!seen.has(id)) ordered.push(id);
    }
    return ordered;
  } catch {
    return [...DEFAULT_ORDER];
  }
}

export function saveModuleOrder(order: ModuleType[]) {
  try {
    localStorage.setItem(MODULE_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* ignore quota / private mode */
  }
}

export function orderedModules(order: ModuleType[]) {
  const byId = new Map(MODULES.map((m) => [m.id, m]));
  return order
    .map((id) => byId.get(id))
    .filter((m): m is (typeof MODULES)[number] => Boolean(m));
}

/** Move `fromId` into the slot currently occupied by `toId`. */
export function moveModule(
  order: ModuleType[],
  fromId: ModuleType,
  toId: ModuleType
): ModuleType[] {
  if (fromId === toId) return order;
  const fromIndex = order.indexOf(fromId);
  const toIndex = order.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return order;

  const next = order.slice();
  next.splice(fromIndex, 1);
  // After removal, indices above `fromIndex` shift down by one. Using the
  // original `toIndex` therefore inserts *before* the target when moving up,
  // and *after* the target when moving down — so adjacent downward moves work.
  next.splice(toIndex, 0, fromId);
  return next;
}
