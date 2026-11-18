#!/usr/bin/env python3
"""Builds a webOS IPK (ar of debian-binary, control.tar.gz, data.tar.gz) without ares-package, laid out like the existing dist/ IPKs.
  python3 scripts/build-ipk.py <app-dir> [<service-dir>] [-o dist]
Writes dist/<appid>_<version>_all.ipk and prints its sha256 and size. Also used by the release workflow, so CI and local builds match."""
import hashlib, io, json, os, subprocess, sys, tarfile, tempfile, time

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

def build(appdir, svcdir, outdir):
    app = json.load(open(os.path.join(appdir, "appinfo.json")))
    svc = json.load(open(os.path.join(svcdir, "services.json")))["id"] if svcdir else None
    pkg = {"id": app["id"], "version": app["version"], "app": app["id"]}
    if svc: pkg["service"] = svc
    paths = ["usr/palm/applications/" + app["id"], "usr/palm/packages/" + app["id"]] + (["usr/palm/services/" + svc] if svc else [])
    work = tempfile.mkdtemp(prefix="ipk.")
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz", format=tarfile.GNU_FORMAT) as t:
        dirs_for(t, paths)
        add_dir(t, "usr/palm/applications/" + app["id"], appdir, skip=("test-launcher.js",))
        if svc: add_dir(t, "usr/palm/services/" + svc, svcdir, skip=("test",))
        raw = (json.dumps(pkg, indent=2) + "\n").encode(); ti = tarfile.TarInfo("usr/palm/packages/%s/packageinfo.json" % app["id"]); ti.size = len(raw); fix(ti, 0o666); t.addfile(ti, io.BytesIO(raw))
    size = sum(m.size for m in tarfile.open(fileobj=io.BytesIO(data.getvalue())).getmembers())
    ctl = ("Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: %d\nMaintainer: N/A <nobody@example.com>\n"
           "Description: This is a webOS application.\nwebOS-Package-Format-Version: 2\nwebOS-Packager-Version: x.y.x\n") % (app["id"], app["version"], size)
    cbuf = io.BytesIO()
    with tarfile.open(fileobj=cbuf, mode="w:gz", format=tarfile.GNU_FORMAT) as t:
        ti = tarfile.TarInfo("control"); raw = ctl.encode(); ti.size = len(raw); fix(ti, 0o666); t.addfile(ti, io.BytesIO(raw))
    open(os.path.join(work, "debian-binary"), "w").write("2.0\n"); open(os.path.join(work, "control.tar.gz"), "wb").write(cbuf.getvalue()); open(os.path.join(work, "data.tar.gz"), "wb").write(data.getvalue())
    os.makedirs(outdir, exist_ok=True)
    out = os.path.abspath(os.path.join(outdir, "%s_%s_all.ipk" % (app["id"], app["version"])))
    if os.path.exists(out): os.unlink(out)
    subprocess.check_call(["ar", "rcD", out, "debian-binary", "control.tar.gz", "data.tar.gz"], cwd=work)
    b = open(out, "rb").read()
    print(json.dumps({"ipk": os.path.relpath(out), "sha256": hashlib.sha256(b).hexdigest(), "size": len(b)}))

if __name__ == "__main__":
    a = [x for x in sys.argv[1:]]; outdir = "dist"
    if "-o" in a: i = a.index("-o"); outdir = a[i + 1]; del a[i:i + 2]
    build(a[0], a[1] if len(a) > 1 else None, outdir)
