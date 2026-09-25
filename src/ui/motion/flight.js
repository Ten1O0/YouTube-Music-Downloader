/**
 * El vuelo de un elemento compartido (plan 09, T7).
 *
 * Un clon de la imagen vuela del rectángulo de `source` al de `target` con la
 * técnica FLIP: se coloca con el tamaño FINAL y se anima solo un `transform`
 * desde la pose inicial hasta la identidad. Nunca se animan width, height,
 * top o left, que obligarían a recalcular el layout en cada fotograma.
 *
 * El progreso p ∈ [0, 1] lo mueve un único muelle. Darle la vuelta a mitad
 * (cerrar mientras se abre) reutiliza ese mismo muelle con la velocidad que
 * llevaba: no hay frenazo ni salto.
 */

import { Spring } from './spring.js';

const mezclar = (a, b, t) => a + (b - a) * t;

/**
 * Pose del clon en el instante p. El clon mide lo que `to`; la pose lo lleva
 * a donde toca con translate + scale, y el radio se divide por la escala en
 * cada eje para que las esquinas no se deformen al escalar.
 */
export function flightPose(from, to, p, radiusFrom = 0, radiusTo = 0) {
    const left = mezclar(from.left, to.left, p);
    const top = mezclar(from.top, to.top, p);
    const width = mezclar(from.width, to.width, p);
    const height = mezclar(from.height, to.height, p);
    const sx = width / to.width;
    const sy = height / to.height;
    const radius = mezclar(radiusFrom, radiusTo, p);
    return {
        tx: left - to.left,
        ty: top - to.top,
        sx,
        sy,
        rx: radius / sx,
        ry: radius / sy,
    };
}

/**
 * Hace volar `image` de `source` a `target`.
 *
 *     const vuelo = fly({ source, target, image, from: 0, to: 1, onProgress });
 *     vuelo.retarget(0);            // da la vuelta conservando la velocidad
 *     const final = await vuelo.done;  // 0 o 1: dónde terminó
 */
export function fly({
    source, target, image,
    radiusFrom = 8, radiusTo = 12,
    from = 0, to = 1,
    preset = 'smooth',
    onProgress = () => {},
}) {
    const a = source.getBoundingClientRect();
    const b = target.getBoundingClientRect();

    const clone = document.createElement('img');
    clone.src = image;
    clone.alt = '';
    clone.className = 'flight-clone';
    clone.setAttribute('aria-hidden', 'true');
    Object.assign(clone.style, {
        position: 'fixed',
        left: `${b.left}px`,
        top: `${b.top}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
        transformOrigin: '0 0',
        objectFit: 'cover',
        zIndex: '1100',
        pointerEvents: 'none',
        willChange: 'transform',
    });
    document.body.appendChild(clone);

    const paint = (p) => {
        const q = flightPose(a, b, p, radiusFrom, radiusTo);
        clone.style.transform = `translate(${q.tx}px, ${q.ty}px) scale(${q.sx}, ${q.sy})`;
        clone.style.borderRadius = `${q.rx}px / ${q.ry}px`;
        onProgress(p);
    };

    const spring = new Spring({ value: from, preset, onUpdate: paint, precision: 0.001 });
    paint(from);

    let heading = to;
    const done = (async () => {
        await spring.to(to);
        // Si alguien le dio la vuelta, la primera promesa se resolvió al
        // asentarse en el nuevo destino; se espera hasta que coincidan.
        while (spring.value !== heading) await spring.to(heading);
        clone.remove();
        return heading;
    })();

    return {
        clone,
        done,
        get progress() { return spring.value; },
        get heading() { return heading; },
        retarget(target) {
            heading = target;
            spring.to(target);
        },
    };
}
