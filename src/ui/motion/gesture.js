/**
 * Gestos: resistencia, velocidad, arrastre vertical y deslizar filas (plan 09, T8 y T15).
 */

/**
 * Resistencia elástica, como la de iOS al pasarse del borde: casi 1:1 al
 * principio y cada vez más dura, sin llegar nunca a `dimension`.
 */
export function rubberBand(overshoot, dimension, constant = 0.55) {
    if (overshoot <= 0 || dimension <= 0) return 0;
    return (1 - 1 / ((overshoot * constant) / dimension + 1)) * dimension;
}

/**
 * Velocidad en px/s a partir de muestras { value, time }, usando solo los
 * últimos `windowMs`: lo que importa es cómo se soltó, no cómo empezó.
 */
export function velocityFrom(samples, windowMs = 80) {
    if (!samples || samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    let first = samples[samples.length - 2];
    for (let i = samples.length - 2; i >= 0; i--) {
        if (last.time - samples[i].time > windowMs) break;
        first = samples[i];
    }
    const dt = last.time - first.time;
    return dt > 0 ? ((last.value - first.value) / dt) * 1000 : 0;
}

/** ¿Se cierra al soltar? Por velocidad o por haber llegado lo bastante lejos. */
export function shouldDismiss({ offset, velocity, size, minVelocity = 550, fraction = 0.28 }) {
    return velocity > minVelocity || offset > size * fraction;
}

/**
 * Deslizar una fila (T15): 1:1 hasta el umbral y, a partir de ahí, con
 * resistencia. Hacia la izquierda no se mueve.
 */
export function swipeOffset(distance, { threshold = 120, dimension = 70 } = {}) {
    if (distance <= 0) return 0;
    if (distance <= threshold) return distance;
    return threshold + rubberBand(distance - threshold, dimension);
}

/** ¿La fila se añade al soltarla? Por distancia o por un golpe rápido. */
export function shouldCommitSwipe({ distance, velocity, threshold = 120, minVelocity = 900, minDistance = 50 }) {
    return distance >= threshold || (velocity > minVelocity && distance > minDistance);
}

/**
 * Arrastre vertical hacia abajo que convive con un contenedor que hace scroll.
 *
 * Solo se queda con el gesto si `canStart()` lo permite (p. ej. el contenido
 * está arriba del todo) y el primer movimiento claro es hacia abajo. En
 * cualquier otro caso el gesto es del scroll, y no se toca.
 *
 * Usa eventos táctiles no pasivos a propósito: con pointer events y
 * `touch-action: pan-y`, el navegador cancela el puntero en cuanto decide
 * desplazar, y no habría forma de quedarse con un arrastre vertical.
 */
export function trackVerticalDrag(el, { canStart = () => true, onStart, onMove, onEnd, slop = 8 } = {}) {
    let estado = null; // null | 'decidiendo' | 'nuestro'

    function alEmpezar(e) {
        if (e.touches.length !== 1 || !canStart(e)) { estado = null; return; }
        const t = e.touches[0];
        estado = { fase: 'decidiendo', x0: t.clientX, y0: t.clientY, muestras: [{ value: t.clientY, time: e.timeStamp }] };
    }

    function alMover(e) {
        if (!estado) return;
        const t = e.touches[0];
        const dx = t.clientX - estado.x0, dy = t.clientY - estado.y0;
        if (estado.fase === 'decidiendo') {
            if (Math.abs(dx) < slop && Math.abs(dy) < slop) return;
            // Hacia arriba o de lado: el gesto es del scroll
            if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { estado = null; return; }
            estado.fase = 'nuestro';
            onStart?.();
        }
        e.preventDefault();
        estado.muestras.push({ value: t.clientY, time: e.timeStamp });
        if (estado.muestras.length > 8) estado.muestras.shift();
        onMove?.(dy);
    }

    function alSoltar() {
        if (estado?.fase === 'nuestro') {
            const muestras = estado.muestras;
            const offset = muestras[muestras.length - 1].value - estado.y0;
            onEnd?.({ offset, velocity: velocityFrom(muestras) });
        }
        estado = null;
    }

    el.addEventListener('touchstart', alEmpezar, { passive: true });
    el.addEventListener('touchmove', alMover, { passive: false });
    el.addEventListener('touchend', alSoltar);
    el.addEventListener('touchcancel', alSoltar);

    return () => {
        el.removeEventListener('touchstart', alEmpezar);
        el.removeEventListener('touchmove', alMover);
        el.removeEventListener('touchend', alSoltar);
        el.removeEventListener('touchcancel', alSoltar);
    };
}
