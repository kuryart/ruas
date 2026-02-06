# Rustro

Cross-platform (Web, Desktop, Mobile), monorepo, and markdown oriented template app made with Tauri, Astro and Actix.

## Usage

### 1. Install modules
```
cd frontend
npm install
```

### 2. Run web frontend

In frontend directory:

```
npm run dev
```

It will be listening in http://localhost:4321

### 3. Run Tauri 

Note: this also runs web frontend.
In frontend directory:

```
npm tauri dev
```

It will run desktop app (and also will be listening in http://localhost:4321)

### 4. Run Web API 

```
cd ..
cd api
cargo run
```
It will run  be listening in http://localhost:8080

### 5. Have fun!

😃

## Inspirations:
- [AstroX](https://github.com/MassivDash/AstroX) by [MassivDash](https://github.com/MassivDash)
- [Tauri + Astro Template](https://github.com/JonasKruckenberg/tauri-astro-template) by [Jonas Kruckenberg](https://github.com/JonasKruckenberg)
