/**
 * El vuelo de un elemento compartido (plan 09, T7).
 *
 * Un clon de la imagen vuela del rectángulo de `source` al de `target` con la
 * técnica FLIP: se coloca con el tamaño FINAL y se anima solo un `transform`
 * desde la pose inicial hasta la identidad. Nunca se animan width, height,
 * top o left, que obligarían a recalcular el layout en cada fotograma.
 *
 * El progreso p ∈ [0, 1] lo mueve un único muelle. Darle la vuelta a mitad
 * (cerrar mientras se abre) sigue desde donde iba y con la velocidad que
 * llevaba: no hay frenazo ni salto.
 *
 * Se carga aparte, la primera vez que se abre el reproductor (plan 28).
 */

import { curvaDesde, animarCurva, enInstante } from './curva.js';
import { scheduler, Spring } from './spring.js';

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
 *     const vuelo = fly({ source, target, image, from: 0, to: 1, capas, onProgress });
 *     vuelo.retarget(0);            // da la vuelta conservando la velocidad
 *     const final = await vuelo.done;  // 0 o 1: dónde terminó
 *
 * Con Web Animations (plan 28) lo mueve el compositor: el clon y cada una de
 * las `capas` ({ el, fotograma(p) → propiedades }) siguen la misma curva de
 * muelle, un fotograma clave por fotograma, y no se paran aunque el hilo
 * principal esté ocupado. Sin ellas, un `Spring` llama a `onProgress(p)` en
 * cada fotograma, como antes.
 */
export function fly({
    source, target, image,
    radiusFrom = 8, radiusTo = 12,
    from = 0, to = 1,
    preset = 'smooth',
    capas = [],
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

    const pose = (p) => flightPose(a, b, p, radiusFrom, radiusTo);
    const transform = (q) => `translate(${q.tx}px, ${q.ty}px) scale(${q.sx}, ${q.sy})`;
    const radio = (q) => `${q.rx}px / ${q.ry}px`;

    if (typeof clone.animate === 'function') return volarEnCompositor({ clone, pose, transform, radio, from, to, preset, capas });

    const paint = (p) => {
        const q = pose(p);
        clone.style.transform = transform(q);
        clone.style.borderRadius = radio(q);
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

/**
 * El vuelo con Web Animations. El transform del clon, las opacidades y los
 * desplazamientos de las capas van en el compositor. El radio de las esquinas
 * va en una animación aparte: no se puede componer, y mezclado con el
 * transform se lo llevaría al hilo principal.
 */
function volarEnCompositor({ clone, pose, transform, radio, from, to, preset, capas }) {
    const pistas = [
        { el: clone, fotograma: (p) => ({ transform: transform(pose(p)) }) },
        { el: clone, fotograma: (p) => ({ borderRadius: radio(pose(p)) }) },
        ...capas,
    ];
    let heading = to;
    let curva = null;
    let animaciones = [];
    let resolver;
    const done = new Promise((ok) => { resolver = ok; });

    const instante = () => enInstante(curva, (animaciones[0]?.currentTime ?? 0) / scheduler.slow);
    const lanzar = (desde, velocidad) => {
        animaciones.forEach((x) => x.cancel());
        curva = curvaDesde({ desde, hasta: heading, velocidad, preset });
        animaciones = pistas.map(({ el, fotograma }) => animarCurva(el, curva, fotograma));
        const esta = animaciones[0];
        esta.finished.then(() => {
            if (animaciones[0] !== esta) return;
            clone.remove();
            resolver(heading);
            // Las capas vuelven a su CSS en el mismo turno en que quien vuela
            // las deja en su sitio (antes del siguiente fotograma)
            queueMicrotask(() => animaciones.forEach((x) => x.cancel()));
        }, () => {});
    };
    lanzar(from, 0);

    return {
        clone,
        done,
        get progress() { return instante().valor; },
        get heading() { return heading; },
        retarget(target) {
            if (target === heading) return;
            const { valor, velocidad } = instante();
            heading = target;
            lanzar(valor, velocidad);
        },
    };
}
