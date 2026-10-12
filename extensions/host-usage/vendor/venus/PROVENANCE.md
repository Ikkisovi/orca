# Venus scanner source

Source: user-controlled `/mnt/intel_ssd/orca-workspaces/orca/shad/src` on Venus, read and copied on 2026-10-12.

Original SHA-256:

- `scanner/pi-scanner.ts`: `627f8f56ebe0022ed55e83ca37e7bc45730ed81866811e051d39099ac74a1e1c`
- `scanner/dsh-scanner.ts`: `9141165e5e3a753d353c76c163767f557bb33a9a924659ef95ba84c2cec5c38a`

The source package declares MIT and identifies its author as Ikkisovi. It was a customized Orca Pi/DSH analytics plugin. The fork retains reference modules alongside the scanner modules used by the build.

Changes to the scanner copy: validate Zstandard frame headers before invoking `zstdcat` with a literal argv array; report discovery, file-read and decompression errors rather than silently turning them into empty usage; when an explicit total is missing, include input, output and both cache buckets without adding reasoning again. The collector sets UTC before scanning and writes caches to its own directory. Original pricing is retained as reference code; Pi/DSH cost estimates are not displayed as known prices.
