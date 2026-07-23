from pathlib import Path

protocol = Path('packages/obs-protocol/src/protocol-v4.ts')
content = protocol.read_text(encoding='utf-8')
before = """  const removedLayerIds = previous.layers
    .filter((layer) => !nextIds.has(layer.id))
    .map((layer) => layer.id);

  if (upsertedLayers.length === 0 && removedLayerIds.length === 0) {
    return null;
  }

  return {
"""
after = """  const removedLayerIds = previous.layers
    .filter((layer) => !nextIds.has(layer.id))
    .map((layer) => layer.id);
  const previousLayerOrder = previous.layers.map((layer) => layer.id);
  const nextLayerOrder = next.layers.map((layer) => layer.id);
  const layerOrderChanged =
    JSON.stringify(previousLayerOrder) !== JSON.stringify(nextLayerOrder);

  if (
    upsertedLayers.length === 0 &&
    removedLayerIds.length === 0 &&
    !layerOrderChanged
  ) {
    return null;
  }

  return {
"""
if before not in content:
    raise RuntimeError('protocol reorder replacement target not found')
content = content.replace(before, after, 1)
content = content.replace(
    "    layerOrder: next.layers.map((layer) => layer.id),",
    "    layerOrder: nextLayerOrder,",
    1,
)
protocol.write_text(content, encoding='utf-8')

test_path = Path('packages/obs-protocol/test/layer-patch.test.ts')
test_content = test_path.read_text(encoding='utf-8')
marker = """  it('Folder親子関係変更を完成Snapshotとして再検証する', () => {
"""
addition = """  it('Layer順序だけの変更もpatchとして適用する', () => {
    const a = textLayer('a', 'A');
    const b = textLayer('b', 'B');
    const previous = snapshot(1, [a, b]);
    const next = snapshot(2, [b, a]);
    const patch = createBroadcastLayerPatch(previous, next);

    expect(patch).not.toBeNull();
    expect(patch?.upsertedLayers).toEqual([]);
    expect(patch?.removedLayerIds).toEqual([]);
    expect(patch?.layerOrder).toEqual(['b', 'a']);
    expect(applyBroadcastLayerPatch(previous, patch!)).toEqual(next);
  });

"""
if marker not in test_content:
    raise RuntimeError('test insertion marker not found')
test_path.write_text(test_content.replace(marker, addition + marker, 1), encoding='utf-8')

for removable in [
    'scripts/fix_layer_patch_reorder.py',
    '.github/workflows/fix-layer-patch-reorder.yml',
    '.github/fix-layer-patch-reorder.trigger',
]:
    target = Path(removable)
    if target.exists():
        target.unlink()
