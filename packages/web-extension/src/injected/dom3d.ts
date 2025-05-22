// 3D Dom viewer, copy-paste this into your console to visualise the DOM as a stack of solid blocks.
// You can also minify and save it as a bookmarklet (https://www.freecodecamp.org/news/what-are-bookmarklets/)

const COLOR_HUE = 190; // hue in HSL (https://hslpicker.com)
const THICKNESS = 20; // thickness of layers

function getDOMDepth(element: Element): number {
  let maxChildDepth = 0;

  let child = element.firstElementChild;
  while (child) {
    const childDepth = getDOMDepth(child);
    if (childDepth > maxChildDepth) {
      maxChildDepth = childDepth;
    }
    child = child.nextElementSibling;
  }

  return maxChildDepth + 1;
}

const maxDepth = getDOMDepth(document.body);
const getColorByDepth = (depth: number) => `hsl(${COLOR_HUE}, 75%, ${5 + (depth * 80) / maxDepth}%)`;

// Rotate the document based on mouse position
document.addEventListener('pointermove', ({ clientX, clientY }) => {
  const rotationY = 180 * (0.5 - clientY / innerHeight);
  const rotationX = 180 * (clientX / innerWidth - 0.5);
  document.body.style.transform = `rotateX(${rotationY}deg) rotateY(${rotationX}deg)`;
});

// Apply initial styles to the body to enable 3D perspective
document.body.style.perspective = `${10000}px`;
document.body.style.overflow = 'visible';
document.body.style.perspectiveOrigin = `${innerWidth / 2}px ${innerHeight / 2}px`;
document.body.style.transformOrigin = `${innerWidth / 2}px ${innerHeight / 2}px`;

// Recursive function to traverse child nodes and apply 3D styles
const traverseDOM = (node: HTMLElement, depthLevel: number) => {
  // Style current node
  node.style.transform = `translateZ(${THICKNESS}px)`;
  node.style.backfaceVisibility = 'hidden';
  node.style.isolation = 'auto';
  node.style.transformStyle = 'preserve-3d';
  node.style.backgroundColor = getColorByDepth(depthLevel);

  // Traverse children
  let child = node.firstElementChild;
  while (child) {
    traverseDOM(child as HTMLElement, depthLevel + 1);
    child = child.nextElementSibling;
  }
};

traverseDOM(document.body, 0);
