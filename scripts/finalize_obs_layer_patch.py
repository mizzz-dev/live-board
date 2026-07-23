from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    target = Path(path)
    current = target.read_text(encoding='utf-8')
    if before not in current:
        raise RuntimeError(f'replacement target not found: {path}: {before[:100]!r}')
    target.write_text(current.replace(before, after, 1), encoding='utf-8')


replace_once(
    'apps/overlay/src/App.tsx',
    """        if (
          currentRevision !== null &&
          incomingSnapshot.revision > currentRevision + 1 &&
          message.type === 'layer.patch'
        ) {
          setRevisionGapCount((count) => count + 1);
          requestLatestSnapshot(currentRevision);
          return;
        }
""",
    """        const hasRevisionGap =
          currentRevision !== null &&
          incomingSnapshot.revision > currentRevision + 1;
        if (hasRevisionGap) {
          setRevisionGapCount((count) => count + 1);
          if (message.type === 'layer.patch') {
            requestLatestSnapshot(currentRevision);
            return;
          }
        }
""",
)

replace_once(
    'README.md',
    '- `snapshot`、`page.changed`、`layer.updated`のWebSocket配信',
    '- `snapshot`、`page.changed`、`layer.patch`のWebSocket配信（旧`layer.updated`受信互換）',
)
replace_once(
    'README.md',
    '- WebSocket Snapshotから画像data URLを除外\n- 描画時間、Layer cache hit、OBS受信遅延の計測',
    '- WebSocket Snapshotから画像data URLを除外\n- base revision付きLayer差分転送と欠番時のフルSnapshot再同期\n- payload比較によるLayer差分／フルSnapshot自動選択\n- 描画時間、Layer cache hit、OBS受信遅延の計測',
)
replace_once(
    'README.md',
    'OBS差分転送、画像タイル化、実機8時間連続試験は後続工程で実施します。',
    'Raster／画像タイル単位の差分転送、実機8時間連続試験は後続工程で実施します。',
)
replace_once(
    'README.md',
    '- 詳細は[画像Assetのloopback HTTP配信設計](docs/asset-http-delivery.md)を参照してください。\n\n### OBS Overlay単体',
    '- 詳細は[画像Assetのloopback HTTP配信設計](docs/asset-http-delivery.md)を参照してください。\n\n### OBS向けLayer差分転送\n\n- 同一ページ内のLayer追加・更新・削除・並び替えは`layer.patch`で配信します。\n- patchにはbase revision、変更Layer、削除Layer ID、最終Layer順序、現在のAsset descriptorを含めます。\n- Overlayは完成Snapshotを再構築し、Layer treeとAsset参照を再検証してから表示へ反映します。\n- base revision不一致、欠番、不正patchでは最後の正常フレームを維持し、最新フルSnapshotを要求します。\n- Page、Canvas、Overlay設定変更と、patchがフルSnapshot以上になる場合はフルSnapshotへフォールバックします。\n- 接続直後、再接続、`snapshot.request`では常にフルSnapshotを送ります。\n- 詳細は[OBS Layer差分転送設計](docs/obs-layer-patch.md)を参照してください。\n\n### OBS Overlay単体',
)
replace_once(
    'README.md',
    '- OBSのLayer差分転送、画像タイル化、ディスクバックドHTTP cacheは後続の性能改善対象です。',
    '- OBSのLayer DTO差分転送は実装済みです。Raster stroke／Fill、画像タイル、Asset binaryの差分は後続対象です。\n- Layer差分には最終Layer ID順序と現在のAsset descriptorを含むため、payloadは完全なO(変更数)ではありません。\n- BridgeはpatchとフルSnapshotをJSON化してbyteLength比較するため、Layer数に応じたCPUコストがあります。\n- ディスクバックドHTTP cacheとWebSocket圧縮は未対応です。',
)
replace_once(
    'README.md',
    '- [画像Assetのloopback HTTP配信](docs/asset-http-delivery.md)\n- [配信性能・長時間安定性試験](docs/performance.md)',
    '- [画像Assetのloopback HTTP配信](docs/asset-http-delivery.md)\n- [OBS Layer差分転送](docs/obs-layer-patch.md)\n- [配信性能・長時間安定性試験](docs/performance.md)',
)

for removable in [
    'scripts/finalize_obs_layer_patch.py',
    '.github/workflows/finalize-obs-layer-patch.yml',
    '.github/finalize-obs-layer-patch.trigger',
]:
    target = Path(removable)
    if target.exists():
        target.unlink()
