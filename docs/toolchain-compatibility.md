# Toolchain and compatibility policy

## Root governance default

The control plane uses **Node 24** and **pnpm 11.9.0**, pinned in `.node-version` and `package.json`. This is the default for root validator scripts and future governance tooling.

It is not a declaration that all sources can be installed together, nor a permission to normalize an imported project during history import. Each import must retain its tested baseline through an explicit compatibility adapter until a separate normalization decision is evidenced.

## Import compatibility matrix

| Import domain | Observed baseline to preserve initially | Adapter requirement before root execution |
| --- | --- | --- |
| Doc-Vader | Node 22 and pnpm 11.9.0 | Verify its existing package/release commands in an isolated artifact adapter. |
| Linkity | Node >=18 with npm lockfiles | Preserve npm-based install and prove the local Doc-Vader dependency replacement with a packed-install test. |
| TemplJS | Node 22/24 and pnpm 8.15.0 | Isolate its pnpm/Nx toolchain and retain its package versus VSIX release split. |
| Pi extensions | pnpm 11-era tooling | Prove test, check, UAT, and Pi load smoke in its own adapter. |
| Babysitter DV | Node >=20 with npm 10 | Preserve npm-based validation and pilot rehearsal. |
| AWX EE Proxmox | Ansible Builder/container runtime | Use a container adapter; it is not a pnpm workspace package. |
| Legacy imports | history-only | Exclude from workspace, catalog, normal CI, and release discovery. |

The matrix records compatibility constraints, not release targets or ownership assignments. Each artifact's catalog record must carry an independent version source and adapter even where root branch policy is uniform.
