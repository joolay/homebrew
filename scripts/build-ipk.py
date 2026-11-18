#!/usr/bin/env python3
"""Builds a webOS IPK (ar of debian-binary, control.tar.gz, data.tar.gz) without ares-package, laid out like the existing dist/ IPKs.
  python3 scripts/build-ipk.py <app-dir> [<service-dir>] [-o dist]
Writes dist/<appid>_<version>_all.ipk and prints its sha256 and size. Also used by the release workflow, so CI and local builds match."""
import hashlib, io, json, os, subprocess, sys, tarfile, tempfile, time, zlib

def add_dir(tar, arcdir, srcdir, skip=()):
    for root, dirs, files in os.walk(srcdir):
        dirs[:] = sorted(d for d in dirs if d not in skip and d != "node_modules" or d == "node_modules" and False)
        rel = os.path.relpath(root, srcdir)
        base = arcdir if rel == "." else arcdir + "/" + rel.replace(os.sep, "/")
        for f in sorted(files):
            if f.startswith(".") or f in skip or f.endswith(".md"): continue
            ti = tar.gettarinfo(os.path.join(root, f), arcname=base + "/" + f); fix(ti, 0o644); tar.addfile(ti, open(os.path.join(root, f), "rb"))

def fix(ti, mode):
    ti.uid = ti.gid = 0; ti.uname = ti.gname = ""; ti.mode = mode; ti.mtime = int(os.environ.get("SOURCE_DATE_EPOCH", time.time()))

def dirs_for(tar, paths):
    seen = set()
    for p in paths:
        parts = p.split("/")
        for i in range(1, len(parts) + 1):
            d = "/".join(parts[:i])
            if d in seen: continue
            seen.add(d); ti = tarfile.TarInfo(d); ti.type = tarfile.DIRTYPE; fix(ti, 0o777); tar.addfile(ti)

def gz(raw):
    """gzip exactly like the IPKs that install on the TV: no timestamp, extra-flags 0, OS = Unix (Python's own writer stamps the time and OS 255)."""
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    body = c.compress(raw) + c.flush()
    return b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\x03" + body + (zlib.crc32(raw) & 0xffffffff).to_bytes(4, "little") + (len(raw) & 0xffffffff).to_bytes(4, "little")

def write_ar(path, members):
    """The archive in the same layout ares-package and the IPKs that already install on the TV use: member names WITHOUT a trailing slash, file type in the mode (100644),
    a real timestamp. GNU `ar rcD` writes "name/", mode 644 and time 0, and the TV's installer then fails with "-5: failed to extract package"."""
    now = int(os.environ.get("SOURCE_DATE_EPOCH", time.time()))
    with open(path, "wb") as f:
        f.write(b"!<arch>\n")
        for name, data in members:
            hdr = ("%-16s%-12d%-6d%-6d%-8s%-10d`\n" % (name, now, 0, 0, "100644", len(data))).encode("ascii"); assert len(hdr) == 60
            f.write(hdr); f.write(data)
            if len(data) % 2: f.write(b"\n")

def build(appdir, svcdir, outdir):
    app = json.load(open(os.path.join(appdir, "appinfo.json")))
    svc = json.load(open(os.path.join(svcdir, "services.json")))["id"] if svcdir else None
    pkg = {"id": app["id"], "version": app["version"], "app": app["id"]}
    if svc: pkg["service"] = svc
    paths = ["usr/palm/applications/" + app["id"], "usr/palm/packages/" + app["id"]] + (["usr/palm/services/" + svc] if svc else [])
    work = tempfile.mkdtemp(prefix="ipk.")
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w", format=tarfile.USTAR_FORMAT) as t:         # POSIX ustar, like the IPKs that install
        dirs_for(t, paths)
        add_dir(t, "usr/palm/applications/" + app["id"], appdir, skip=("test-launcher.js",))
        if svc: add_dir(t, "usr/palm/services/" + svc, svcdir, skip=("test",))
        raw = (json.dumps(pkg, indent=2) + "\n").encode(); ti = tarfile.TarInfo("usr/palm/packages/%s/packageinfo.json" % app["id"]); ti.size = len(raw); fix(ti, 0o666); t.addfile(ti, io.BytesIO(raw))
    tar_raw = data.getvalue(); size = sum(m.size for m in tarfile.open(fileobj=io.BytesIO(tar_raw)).getmembers())
    ctl = ("Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: %d\nMaintainer: N/A <nobody@example.com>\n"
           "Description: This is a webOS application.\nwebOS-Package-Format-Version: 2\nwebOS-Packager-Version: x.y.x\n") % (app["id"], app["version"], size)
    cbuf = io.BytesIO()
    with tarfile.open(fileobj=cbuf, mode="w", format=tarfile.USTAR_FORMAT) as t:
        ti = tarfile.TarInfo("control"); raw = ctl.encode(); ti.size = len(raw); fix(ti, 0o666); t.addfile(ti, io.BytesIO(raw))
    os.makedirs(outdir, exist_ok=True)
    out = os.path.abspath(os.path.join(outdir, "%s_%s_all.ipk" % (app["id"], app["version"])))
    if os.path.exists(out): os.unlink(out)
    write_ar(out, [("debian-binary", b"2.0\n"), ("control.tar.gz", gz(cbuf.getvalue())), ("data.tar.gz", gz(tar_raw))])
    b = open(out, "rb").read()
    print(json.dumps({"ipk": os.path.relpath(out), "sha256": hashlib.sha256(b).hexdigest(), "size": len(b)}))

if __name__ == "__main__":
    a = [x for x in sys.argv[1:]]; outdir = "dist"
    if "-o" in a: i = a.index("-o"); outdir = a[i + 1]; del a[i:i + 2]
    build(a[0], a[1] if len(a) > 1 else None, outdir)
