# ── Ruas dev container ────────────────────────────────────────────────────────
# Purpose : Claude Code, cargo test, pnpm test (Vitest), pnpm test:e2e (Playwright headless)
# NOT for : pnpm tauri dev / tauri build — use the build container for that.
#
# No display server needed: Playwright runs in headless Chromium, and the E2E
# specs mock all API calls via page.route(), so no Rust API server is required.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

# ── Base tools ────────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    gnupg \
    # Needed by some Rust crates (openssl-sys) even though rusqlite is bundled.
    libssl-dev \
    pkg-config \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 22 ────────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── pnpm 10 ───────────────────────────────────────────────────────────────────
RUN npm install -g pnpm@10

# ── Non-root user ─────────────────────────────────────────────────────────────
# UID/GID 1000 matches the default user on most Linux hosts, avoiding file
# permission issues with bind-mounted workspaces.
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=1000

RUN groupadd --gid ${USER_GID} ${USERNAME} \
    && useradd --uid ${USER_UID} --gid ${USER_GID} -m --shell /bin/bash ${USERNAME} \
    && echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} \
    && chmod 0440 /etc/sudoers.d/${USERNAME}

# ── Rust (installed as the dev user so CARGO_HOME lives in ~/) ────────────────
# The toolchain version is controlled by rust-toolchain.toml at the repo root;
# rustup will honour it automatically on the first cargo invocation.
USER ${USERNAME}

ENV CARGO_HOME=/home/${USERNAME}/.cargo \
    RUSTUP_HOME=/home/${USERNAME}/.rustup \
    PATH=/home/${USERNAME}/.cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --default-toolchain stable \
       --component rustfmt clippy

WORKDIR /workspace
