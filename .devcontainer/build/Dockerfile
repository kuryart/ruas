# ── Ruas build container ─────────────────────────────────────────────────────
# Purpose : pnpm tauri dev, pnpm tauri build, bundle production artifacts
#           (.deb, .rpm, AppImage)
#
# Extends the dev setup with:
#   • WebKit2GTK 4.1 — required by Tauri v2 (NOT 4.0; wrong version breaks silently)
#   • GTK3, libsoup 3, appindicator, rsvg — Tauri Linux runtime dependencies
#   • Xvfb — virtual display for pnpm tauri dev (no real GPU/compositor needed)
#   • squashfs-tools — used by tauri-bundler when creating AppImage archives
#   • dpkg-dev / rpm — for .deb and .rpm packaging

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    # Xvfb virtual display — referenced by pnpm tauri dev and tauri-bundler
    DISPLAY=:99

# ── Base tools (same as dev container) ───────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    gnupg \
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

# ── Tauri v2 Linux build dependencies ─────────────────────────────────────────
# Source: https://v2.tauri.app/start/prerequisites/#linux
# libwebkit2gtk-4.1-dev is the Tauri v2 requirement; 4.0 produces a linker error.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libgtk-3-dev \
    libglib2.0-dev \
    libsoup-3.0-dev \
    file \
    wget \
    && rm -rf /var/lib/apt/lists/*

# ── Bundle tools ──────────────────────────────────────────────────────────────
# squashfs-tools: tauri-bundler uses mksquashfs when building AppImages.
# dpkg-dev / rpm: for .deb and .rpm packaging targets.
# Note: running AppImages requires FUSE and a privileged container, but
# *building* them only needs squashfs-tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    squashfs-tools \
    dpkg-dev \
    rpm \
    && rm -rf /var/lib/apt/lists/*

# ── Virtual display ───────────────────────────────────────────────────────────
# Xvfb provides a headless X11 server so WebKit2GTK can initialise its renderer.
# Started in postStartCommand (devcontainer.json), not here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# ── Non-root user ─────────────────────────────────────────────────────────────
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=1000

RUN groupadd --gid ${USER_GID} ${USERNAME} \
    && useradd --uid ${USER_UID} --gid ${USER_GID} -m --shell /bin/bash ${USERNAME} \
    && echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} \
    && chmod 0440 /etc/sudoers.d/${USERNAME}

# ── Rust ─────────────────────────────────────────────────────────────────────
USER ${USERNAME}

ENV CARGO_HOME=/home/${USERNAME}/.cargo \
    RUSTUP_HOME=/home/${USERNAME}/.rustup \
    PATH=/home/${USERNAME}/.cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --default-toolchain stable \
       --component rustfmt clippy

WORKDIR /workspace
