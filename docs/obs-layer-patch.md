# OBS Layer差分転送設計

## 1. 目的

同一ページ内で一部のLayerだけが変化した場合に、全`BroadcastSnapshot`をWebSocketへ再送せず、変更分だけをOverlayへ届けます。

画像Assetのバイナリはloopback HTTPへ分離済みですが、従来の`layer.updated`は100LayerすべてのDTOを含むフルSnapshotでした。本変更ではLayer数に比例する転送量を削減しつつ、再接続・欠番・不正差分時にはフルSnapshotへ安全に復帰できる構成を優先します。

## 2. メッセージ形式

新しいServer messageを追加します。

```ts
{
  type: 'layer.patch',
  patch: {
    projectId: string,
    pageId: string,
    baseRevision: number,
    revision: number,
    generatedAt: string,
    upsertedLayers: BroadcastLayer[],
    removedLayerIds: string[],
    layerOrder: string[],
    assets?: BroadcastAsset[],
  },
}
```

### 各項目の責務

- `baseRevision`: 差分適用元として必要なOverlay側revision
- `revision`: 適用後のrevision
- `upsertedLayers`: 新規Layerまたは内容が変化したLayer
- `removedLayerIds`: 削除されたLayer
- `layerOrder`: 適用後の全Layer ID順序
- `assets`: 適用後Snapshotで参照可能な現在のAsset descriptor

`layerOrder`はLayer本体を含まないため、並び替えだけの操作でも小さなpayloadで表現できます。

## 3. patchを送る条件

次をすべて満たす場合だけpatch候補を作ります。

- 前回Snapshotが存在する
- Project IDが同一
- Page IDが同一
- Page名が同一
- Canvas設定が同一
- Overlay設定が同一
- Layer内容・追加・削除・順序のいずれかが変化している

次の場合はフルSnapshotへフォールバックします。

- 初回接続
- 再接続
- `snapshot.request`
- Page変更
- Project変更
- Page名変更
- Canvas設定変更
- Overlayテーマ・プリセット・カスタムCSS等の変更
- patch JSONがフルSnapshot JSON以上のサイズ
- Layer差分が存在しない

Page変更は従来どおり`page.changed`とtransitionを送信します。

## 4. Overlayでの適用

Overlayは現在保持しているSnapshotに対して次の順で処理します。

1. `projectId`と`pageId`を照合
2. `baseRevision`と現在revisionを照合
3. `removedLayerIds`を削除
4. `upsertedLayers`を追加または置換
5. `layerOrder`に従ってLayer配列を再構築
6. Asset descriptorを現在値へ更新
7. 完成したSnapshot全体を`parseBroadcastSnapshot`で再検証
8. 検証成功後にのみ現在Snapshotを更新

完成Snapshotの再検証により、次を差分単体ではなく最終状態として確認します。

- Layer ID重複
- Folder親子関係
- parent／childの相互参照
- Image LayerのAsset参照
- Layer上限
- Asset ID・SHA-256重複
- Canvas・Overlay・Layer DTOの既存制約

## 5. 欠番・不正差分の復旧

次の場合はpatchを適用せず、現在revisionを付けて`snapshot.request`を送ります。

- 現在Snapshotがない
- `baseRevision`が現在revisionと一致しない
- patch revisionが欠番になっている
- Layer削除対象が存在しない
- `layerOrder`が完成Layer集合と一致しない
- 完成SnapshotのProtocol検証に失敗する
- `layer.patch`自体のruntime parseに失敗する

Bridgeは要求元revisionと最新revisionが異なる場合、最新のフルSnapshotを返します。

不正なpatchを受信しても、最後の正常フレームは維持します。

## 6. 後方互換

- 旧`layer.updated`フルSnapshotを引き続きparse・表示できる
- Bridgeは新規更新では`layer.patch`または`snapshot`を選択する
- 接続直後は常にフル`snapshot`
- `.liveboard`形式とDomain schemaは変更しない
- Asset HTTP delivery形式は変更しない

## 7. 性能判断

Bridgeは`JSON.stringify`後のUTF-8 byteLengthを比較します。

```text
patch payload < full snapshot payload
```

の場合だけpatchを送信します。Layer数が少ない、変更Layerが多い、Asset descriptorが多い等で差分化の効果がない場合はフルSnapshotを選びます。

MVPではLayer単位差分までとし、Raster stroke・Fill・タイル内部の差分は扱いません。

## 8. 対象外

- Raster stroke単位差分
- 画像タイル単位差分
- Asset binary差分
- WebSocket圧縮
- Desktop RendererからElectron MainへのIPC差分化
- LAN・外部サーバー配信

## 9. テスト観点

- 単一Layer更新
- Layer追加・削除
- 純粋なLayer並び替え
- Folder親子関係変更
- Image LayerとHTTP Asset descriptor
- 連続patch
- base revision不一致
- revision欠番
- Page／Project不一致
- 重複ID・不正order
- Asset参照不整合
- Canvas／Overlay設定変更時のfallback
- patch／full payload byte比較
- 接続時・再接続時・`snapshot.request`時のフルSnapshot
- 旧`layer.updated`互換
