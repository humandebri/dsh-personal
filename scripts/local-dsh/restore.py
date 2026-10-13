#!/usr/bin/env python3
"""Restore credential-free local files. Dry run by default; refuse conflicting files."""
import argparse
from pathlib import Path
import shutil


def restore(source, target, apply=False):
    copies = []
    for item in sorted((source / "files").rglob("*")):
        if item.is_file():
            output = target / item.relative_to(source / "files")
            copies.append((output, item.read_bytes(), item.stat().st_mode & 0o777))
    # Single-quoted YAML strings escape apostrophes by doubling them.
    overlay = (source / "claude.overlay.yml.in").read_text().replace("@DSH_ROOT@", str(target).replace("'", "''"))
    copies.append((target / "runtime/claude-profile.overlay.yml", overlay.encode(), 0o600))
    for output, data, _ in copies:
        if output.is_symlink() or (output.exists() and (not output.is_file() or output.read_bytes() != data)):
            raise RuntimeError(f"Existing file differs; preserve or move it before restoring: {output}")
        parent = output.parent
        while parent != target:
            if parent.is_symlink():
                raise RuntimeError(f"Refusing symlink parent: {parent}")
            parent = parent.parent
    for output, data, mode in copies:
        print(output.relative_to(target))
        if apply and not output.exists():
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)
            output.chmod(mode)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--root", type=Path, help="DSH layout root; defaults to the parent of core")
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    target = (args.root or source.parents[2]).resolve()
    restore(source, target, args.apply)
