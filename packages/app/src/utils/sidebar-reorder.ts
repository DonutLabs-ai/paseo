export function mergeWithRemainder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedVisibleKeys);
  const remainder = input.currentOrder.filter((key) => !reorderedSet.has(key));
  return [...input.reorderedVisibleKeys, ...remainder];
}

export function hasVisibleOrderChanged(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): boolean {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const currentVisible = input.currentOrder.filter((key) => visibleSet.has(key));
  if (currentVisible.length !== input.reorderedVisibleKeys.length) {
    return true;
  }
  return input.reorderedVisibleKeys.some((key, index) => currentVisible[index] !== key);
}

/** Reorders a visible subgroup in place without moving rows that belong to other subgroups. */
export function mergeReorderedSubset(input: {
  currentOrder: string[];
  reorderedSubset: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedSubset);
  let reorderedIndex = 0;
  return input.currentOrder.map((key) => {
    if (!reorderedSet.has(key)) return key;
    const reorderedKey = input.reorderedSubset[reorderedIndex];
    reorderedIndex += 1;
    if (reorderedKey === undefined) {
      throw new Error("Reordered subset does not contain every replaced key");
    }
    return reorderedKey;
  });
}
