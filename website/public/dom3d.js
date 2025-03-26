// 3D Dom viewer, copy-paste this into your console to visualise the DOM as a stack of solid blocks.
// You can also minify and save it as a bookmarklet (https://www.freecodecamp.org/news/what-are-bookmarklets/)
(() => {
  const COLOR_HUE = 190; // hue in HSL (https://hslpicker.com)
  const THICKNESS = 20; // thickness of layers

  const getDOMDepth = () => {
    let m = 0;
    const t = (e, d) => {m = Math.max(m, d); for(let c of e.children) t(c, d + 1)};
    t(document.body, 0);
    return m;
  };

  const maxDepth = getDOMDepth();
  const getColorByDepth = depth => `hsl(${COLOR_HUE}, 75%, ${5 + (depth * 80 / maxDepth)}%)`;

  // Rotate the document based on mouse position
  document.addEventListener("pointermove", ({clientX, clientY}) => {
    const rotationY = 180 * (0.5 - clientY / innerHeight);
    const rotationX = 180 * (clientX / innerWidth - 0.5);
    document.body.style.transform = `rotateX(${rotationY}deg) rotateY(${rotationX}deg)`;
  });

  // Apply initial styles to the body to enable 3D perspective
  Object.assign(document.body.style, {
    perspective: `${10000}px`,
    overflow: "visible",
    perspectiveOrigin: `${innerWidth/2}px ${innerHeight/2}px`,
    transformOrigin: `${innerWidth/2}px ${innerHeight/2}px`
  });

  // Recursive function to traverse child nodes and apply 3D styles
  const traverseDOM = (node, depthLevel) => {
    // Only process element nodes
    if (node.nodeType !== 1) return;
    
    // Style current node
    Object.assign(node.style, {
      transform: `translateZ(${THICKNESS}px)`,
      backfaceVisibility: "hidden",
      isolation: "auto",
      transformStyle: "preserve-3d",
      backgroundColor: getColorByDepth(depthLevel),
    });

    // Traverse children
    for (const childNode of node.children) {
      traverseDOM(childNode, depthLevel + 1);
    }
  }

  traverseDOM(document.body, 0);
})()