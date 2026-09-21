#!/usr/bin/env bash
# Ejecuta la suite completa: backend (pytest) y frontend (node --test).
set -uo pipefail
cd "$(dirname "$0")/.."

VENV_PY=".venv/bin/python"
fallos=0

echo "============================================================"
echo "  BACKEND (pytest)"
echo "============================================================"
if [ ! -x "$VENV_PY" ]; then
    echo "  No existe .venv. Créalo con:"
    echo "    python3 -m venv .venv && .venv/bin/pip install -r test/requirements-test.txt"
    fallos=$((fallos + 1))
else
    "$VENV_PY" -m pytest test/backend/ -q || fallos=$((fallos + 1))
fi

echo
echo "============================================================"
echo "  FRONTEND (node --test)"
echo "============================================================"
if ! command -v node >/dev/null 2>&1; then
    echo "  Node no está instalado; se omite el frontend."
    echo "    brew install node"
else
    node --test test/frontend/ || fallos=$((fallos + 1))
fi

echo
if [ "$fallos" -eq 0 ]; then
    echo "TODO OK"
else
    echo "HAY $fallos BLOQUE(S) CON FALLOS"
fi
exit "$fallos"
