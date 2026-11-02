"""
DocProbe - Streamlit Web アプリケーション
- 「今すぐ同期」ボタンと最終同期時刻の表示
- Gemini (gemini-3.8-flash) を活用した検索・最新版判定・3行要約
- トークン使用量トラッキング & アラート表示
"""

import os
import json
import datetime
import streamlit as st
from sync import sync, load_existing_store, STORE_PATH, META_PATH
from search import search
from token_tracker import get_usage_summary
from gemini_client import get_backend_info

st.set_page_config(
    page_title="DocProbe",
    page_icon="🔍",
    layout="wide",
)

# カスタムCSS
st.markdown(
    """
    <style>
    .main-title {
        font-size: 2.2rem;
        font-weight: 700;
        margin-bottom: 0.2rem;
    }
    .sub-title {
        color: #555;
        font-size: 1.05rem;
        margin-bottom: 1.5rem;
    }
    .status-card {
        background-color: #f8f9fa;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 0.75rem 1rem;
        margin-bottom: 1rem;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


def get_meta_info():
    """最終同期時刻とページ総数を取得する。"""
    last_synced = "未同期"
    total_pages = 0

    if os.path.exists(META_PATH):
        try:
            with open(META_PATH, "r", encoding="utf-8") as f:
                meta = json.load(f)
                iso_time = meta.get("last_synced_at")
                if iso_time:
                    dt = datetime.datetime.fromisoformat(iso_time).astimezone()
                    last_synced = dt.strftime("%Y年%m月%d日 %H:%M:%S")
                total_pages = meta.get("total_pages", 0)
        except Exception:
            pass
    elif os.path.exists(STORE_PATH):
        try:
            mtime = os.path.getmtime(STORE_PATH)
            dt = datetime.datetime.fromtimestamp(mtime)
            last_synced = dt.strftime("%Y年%m月%d日 %H:%M:%S")
            pages = load_existing_store()
            total_pages = len(pages)
        except Exception:
            pass

    return last_synced, total_pages


# --- ヘッダー ---
st.markdown('<div class="main-title">🔍 DocProbe</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-title">研究室の資料探査機 ― NotionやBoxに埋もれた資料を、あいまいな質問から探り当てる</div>',
    unsafe_allow_html=True,
)

# メタ情報とトークン使用状況の取得
last_synced, total_pages = get_meta_info()
usage_info = get_usage_summary()
backend_info = get_backend_info()

# --- トークンアラート（警告・上限到達時） ---
daily_used = usage_info["daily_total"]
daily_limit = usage_info["daily_limit"]
ratio = usage_info["ratio"]

if ratio >= 1.0:
    st.error(
        f"🚨 **トークン上限到達アラート**: 本日のトークン使用量が上限に到達しました "
        f"（{daily_used:,} / {daily_limit:,} トークン = {ratio:.0%}）。API呼び出しが一時停止されます。"
    )
elif ratio >= 0.8:
    st.warning(
        f"⚠️ **トークン使用量注意**: 本日のトークン使用量が {ratio:.0%} に達しています "
        f"（{daily_used:,} / {daily_limit:,} トークン）。使いすぎにご注意ください。"
    )

# --- 同期ステータス ＆ コントロールバー ---
col_sync1, col_sync2, col_sync3 = st.columns([2, 3, 2])
with col_sync1:
    sync_clicked = st.button("🔄 今すぐ同期", use_container_width=True, type="primary")

with col_sync2:
    st.info(f"🕒 **最終同期時刻**: {last_synced} （同期済み: {total_pages} ページ）")

with col_sync3:
    backend_label = "Google Cloud (Vertex AI)" if backend_info["backend"] == "vertexai" else "Gemini API"
    st.caption(f"⚡ 実行基盤: **{backend_label}**\n\n📊 本日消費: `{daily_used:,} / {daily_limit:,}` トークン")

# 同期ボタン押下時の処理
if sync_clicked:
    with st.spinner("Notionから最新データを同期中（差分取得・画像解析中）..."):
        res = sync()
        if res.get("status") == "success":
            st.success(f"🎉 {res.get('message')}")
            st.rerun()
        else:
            st.error(f"❌ 同期エラー: {res.get('message')}")

st.markdown("---")

# --- メインコンテンツ：検索タブ & 同期済み一覧タブ & トークン管理タブ ---
tab_search, tab_browse, tab_usage = st.tabs(["🔎 資料探査（検索）", "📚 同期済みドキュメント", "📊 トークン使用状況"])

with tab_search:
    st.subheader("自然言語で探査（検索）")
    st.caption("例: 「最新の測定手順書を教えて」「機材の貸出期限は何日？」「2026年の手順変更点」「解析コードの動かし方」")

    query = st.text_input("検索クエリを入力", placeholder="知りたいことやキーワードを入力してください...", label_visibility="collapsed")
    btn_search = st.button("探査（検索）する", type="secondary")

    if btn_search or (query and st.session_state.get("last_query") != query):
        if not query.strip():
            st.warning("検索クエリを入力してください。")
        else:
            st.session_state["last_query"] = query
            with st.spinner("DocProbeが2段階探査中（ベクトル類似度計算 ＆ Gemini要約・最新版判定）..."):
                search_res = search(query)
                if isinstance(search_res, tuple) and len(search_res) == 3:
                    result_text, top_candidates, alert_info = search_res
                elif isinstance(search_res, tuple) and len(search_res) == 2:
                    result_text, alert_info = search_res
                    top_candidates = []
                else:
                    result_text, top_candidates, alert_info = str(search_res), [], None

                if alert_info and alert_info.get("alert") == "block":
                    st.error(alert_info.get("message"))
                elif alert_info and alert_info.get("alert") == "warn":
                    st.warning(alert_info.get("message"))

                # 類似度スコア付きの上位候補リストを表示
                if top_candidates:
                    st.markdown("#### 🎯 類似度スコア上位の候補ドキュメント (Top 5)")
                    for rank, cand in enumerate(top_candidates, 1):
                        score = cand.get("score", 0.0)
                        score_pct = max(0.0, min(score, 1.0)) * 100
                        col_c1, col_c2 = st.columns([5, 2])
                        with col_c1:
                            st.markdown(f"**#{rank} [{cand.get('title')}]({cand.get('url')})**")
                            st.caption(f"最終更新: `{cand.get('updated')}` | ソース: `{cand.get('source')}`")
                        with col_c2:
                            st.metric(label="類似度スコア", value=f"{score:.4f}", delta=f"{score_pct:.1f}%")
                            st.progress(max(0.0, min(score, 1.0)))
                        st.markdown("<hr style='margin: 0.5rem 0;'>", unsafe_allow_html=True)

                st.markdown("### 📋 DocProbe AI 分析・要約レポート")
                st.markdown(result_text)

with tab_browse:
    st.subheader("同期済みドキュメント一覧")
    pages = load_existing_store()
    if not pages:
        st.info("まだデータが同期されていません。上の「今すぐ同期」ボタンを押してください。")
    else:
        st.write(f"合計 **{len(pages)}** 件のページがローカルにキャッシュされています。")
        for i, p in enumerate(pages, 1):
            with st.expander(f"📄 {p.get('title', '(無題)')} — 最終更新: {p.get('updated', '不明')}"):
                st.markdown(f"**URL**: [{p.get('url')}]({p.get('url')})")
                st.markdown(f"**ソース**: `{p.get('source')}`")
                st.text_area("本文テキスト", p.get("text", ""), height=180, key=f"text_{i}", disabled=True)

with tab_usage:
    st.subheader("トークン消費量と安全管理")
    mcol1, mcol2, mcol3 = st.columns(3)
    with mcol1:
        st.metric("本日の消費トークン", f"{daily_used:,}", f"上限 {daily_limit:,}")
    with mcol2:
        st.metric("本日リクエスト回数", f"{usage_info['daily_requests']} 回")
    with mcol3:
        st.metric("累計消費トークン", f"{usage_info['total_input'] + usage_info['total_output']:,}")

    st.progress(min(ratio, 1.0))
    st.caption(f"日次上限までの使用率: **{ratio * 100:.1f}%** （上限設定は `.env` の `TOKEN_DAILY_LIMIT` で変更可能）")

    if usage_info["history"]:
        st.write("##### 直近のAPI呼び出し履歴")
        history_table = []
        for h in reversed(usage_info["history"][-10:]):
            history_table.append({
                "時刻": h.get("time"),
                "用途": h.get("caller"),
                "モデル": h.get("model"),
                "入力トークン": f"{h.get('input', 0):,}",
                "出力トークン": f"{h.get('output', 0):,}",
            })
        st.table(history_table)
