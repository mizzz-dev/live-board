import type { WorkspacePersistenceController } from './useWorkspacePersistence';
import './workspace-persistence.css';

export function WorkspacePersistencePanel({
  controller,
}: {
  controller: WorkspacePersistenceController;
}) {
  return (
    <section className="workspace-persistence">
      <div className="panel-heading">
        <h2>保存・復元</h2>
        <span>{controller.status}</span>
      </div>

      <div className="persistence-actions" aria-label="ワークスペース保存操作">
        <button
          type="button"
          disabled={!controller.enabled || controller.busy}
          onClick={() => void controller.save()}
        >
          保存
        </button>
        <button
          type="button"
          disabled={!controller.enabled || controller.busy}
          onClick={() => void controller.saveAs()}
        >
          名前を付けて保存
        </button>
        <button
          type="button"
          disabled={!controller.enabled || controller.busy}
          onClick={() => void controller.open()}
        >
          開く
        </button>
        <button
          type="button"
          disabled={controller.busy}
          onClick={controller.duplicateCurrent}
        >
          複製
        </button>
        <button
          type="button"
          disabled={!controller.enabled || controller.busy}
          onClick={() => void controller.importCopy()}
        >
          インポート
        </button>
      </div>

      <dl className="persistence-summary">
        <div>
          <dt>現在</dt>
          <dd>{controller.document?.displayName ?? '未保存ワークスペース'}</dd>
        </div>
        <div>
          <dt>revision</dt>
          <dd>{controller.revision}</dd>
        </div>
      </dl>

      {controller.error === null ? null : (
        <p className="persistence-error" role="alert">
          {controller.error}
        </p>
      )}

      <div className="persistence-list-heading">
        <h3>最近使用</h3>
        <button
          type="button"
          disabled={!controller.enabled || controller.busy}
          onClick={() => void controller.refresh()}
        >
          更新
        </button>
      </div>
      {controller.recentDocuments.length === 0 ? (
        <p className="persistence-empty">最近使用したファイルはありません</p>
      ) : (
        <div className="persistence-list" aria-label="最近使用したワークスペース">
          {controller.recentDocuments.map((document) => (
            <article className="persistence-row" key={document.documentId}>
              <button
                type="button"
                className="persistence-open"
                disabled={controller.busy}
                onClick={() => void controller.openRecent(document.documentId)}
              >
                <strong>{document.displayName}</strong>
                <small>最終利用 {formatTimestamp(document.lastOpenedAt)}</small>
              </button>
              <button
                type="button"
                aria-label={`${document.displayName}を${document.favorite ? 'お気に入りから外す' : 'お気に入りに追加'}`}
                aria-pressed={document.favorite}
                disabled={controller.busy}
                onClick={() =>
                  void controller.toggleFavorite(
                    document.documentId,
                    !document.favorite,
                  )
                }
              >
                {document.favorite ? '★' : '☆'}
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="persistence-list-heading">
        <h3>クラッシュ復元</h3>
        <span>{controller.recoveryCandidates.length}件</span>
      </div>
      {controller.recoveryCandidates.length === 0 ? (
        <p className="persistence-empty">復元候補はありません</p>
      ) : (
        <div className="persistence-list" aria-label="クラッシュ復元候補">
          {controller.recoveryCandidates.map((candidate) => (
            <article className="recovery-row" key={candidate.candidateId}>
              <div>
                <strong>{candidate.workspaceId}</strong>
                <small>
                  revision {candidate.revision}・{formatTimestamp(candidate.savedAt)}
                </small>
                <small>
                  snapshot後の操作 {candidate.operationCountAfterSnapshot}件
                </small>
              </div>
              <div>
                <button
                  type="button"
                  disabled={controller.busy}
                  onClick={() => void controller.restore(candidate.candidateId)}
                >
                  復元
                </button>
                <button
                  type="button"
                  disabled={controller.busy}
                  onClick={() => void controller.discard(candidate.candidateId)}
                >
                  破棄
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP');
}
