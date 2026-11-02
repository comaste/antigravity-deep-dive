"""
TEMインバージョン デモスクリプト（研究室共有用）
作成日: 2026-10-20 / 版: v1.3

使い方:
    python tem_inversion_demo.py --layers 3

注意:
    - 送信ループサイズは 40m x 40m を前提（2026年10月以降の観測から変更）
    - 初期モデルは3層構造、比抵抗の初期値は 100 Ω·m
    - 正則化パラメータ LAMBDA_REG は 0.03 が研究室の標準値
    - 観測データは NAS の /share/tem/lineA3/ に保存すること
"""
import argparse

import numpy as np

TX_LOOP_SIZE_M = 40.0      # 送信ループの一辺の長さ [m]
DEFAULT_LAYERS = 3         # 初期モデルの層数
INITIAL_RESISTIVITY = 100.0  # 比抵抗の初期値 [Ω·m]
LAMBDA_REG = 0.03          # 正則化パラメータ


def forward_model(log_rho, times):
    """層構造モデル（対数比抵抗）から過渡応答 dB/dt を計算する簡易フォワード計算。"""
    rho = np.exp(log_rho)
    depth_weight = np.linspace(1.0, 0.3, len(rho))
    effective_rho = np.sum(rho * depth_weight) / np.sum(depth_weight)
    return (TX_LOOP_SIZE_M ** 2) / effective_rho * times ** (-2.5)


def steepest_descent_inversion(observed, times, n_layers=DEFAULT_LAYERS,
                               n_iter=200, step=0.05):
    """最急降下法で比抵抗構造を推定する（数値微分による勾配）。"""
    log_rho = np.full(n_layers, np.log(INITIAL_RESISTIVITY))
    for _ in range(n_iter):
        base = _misfit(log_rho, observed, times)
        grad = np.zeros_like(log_rho)
        for i in range(n_layers):
            d = np.zeros_like(log_rho)
            d[i] = 1e-4
            grad[i] = (_misfit(log_rho + d, observed, times) - base) / 1e-4
        log_rho -= step * grad
    return np.exp(log_rho)


def _misfit(log_rho, observed, times):
    """観測値との誤差（対数）＋ 正則化項。"""
    pred = forward_model(log_rho, times)
    data_term = np.mean((np.log(pred) - np.log(observed)) ** 2)
    reg_term = LAMBDA_REG * np.sum(np.diff(log_rho) ** 2)
    return data_term + reg_term


def estimate_resistivity_layers(n_layers=DEFAULT_LAYERS):
    """合成データを作って比抵抗構造を推定し、結果を表示する。"""
    times = np.logspace(-5, -2, 30)
    true_log_rho = np.log(np.array([50.0, 300.0, 20.0])[:n_layers])
    observed = forward_model(true_log_rho, times)
    estimated = steepest_descent_inversion(observed, times, n_layers=n_layers)
    for i, rho in enumerate(estimated, start=1):
        print(f"第{i}層の推定比抵抗: {rho:.1f} Ω·m")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TEMインバージョン デモ")
    parser.add_argument("--layers", type=int, default=DEFAULT_LAYERS)
    args = parser.parse_args()
    estimate_resistivity_layers(args.layers)
