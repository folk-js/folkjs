(() => {
  const CONFIG = {
    COLOR_HUE: 190,
    MAX_ROTATION: 45,
    THICKNESS: 20,
    DISTANCE: 10000
  };

  // Helper functions
  const getDOMDepth = (root) => {
    let m = 0;
    const t = (e, d) => {m = Math.max(m, d); for(let c of e.children) t(c, d + 1)};
    t(root, 0);
    return m;
  };

  const make3D = (element) => {
    const maxDepth = getDOMDepth(element);
    const getColorByDepth = (depth, hue = 0, lighten = 0) => 
      `hsl(${hue}, 75%, ${Math.min(10 + depth * (1 + 60 / maxDepth), 90) + lighten}%)`;

    // Apply initial styles to the container
    Object.assign(element.style, {
      transformStyle: "preserve-3d",
      perspective: `${CONFIG.DISTANCE}px`,
      overflow: "visible",
      transition: 'transform 0.1s ease-out'
    });

    // Update perspective based on scroll
    const updatePerspective = () => {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportProgress = (rect.top + rect.height / 2) / viewportHeight;
      const rotationX = CONFIG.MAX_ROTATION * (0.5 - viewportProgress);
      
      element.style.transform = `rotateX(${rotationX}deg)`;
    };

    // Initial update
    updatePerspective();
    
    // Add scroll listener
    window.addEventListener('scroll', updatePerspective, { passive: true });
    window.addEventListener('resize', updatePerspective, { passive: true });

    // Recursive function to traverse child nodes and apply 3D styles
    function traverseDOM(node, depthLevel) {
      if (node.nodeType !== 1) return;
      
      const color = getColorByDepth(depthLevel, CONFIG.COLOR_HUE, -5);
      Object.assign(node.style, {
        transform: `translateZ(${CONFIG.THICKNESS * (depthLevel + 1)}px)`,
        backfaceVisibility: "hidden",
        transformStyle: "preserve-3d",
        backgroundColor: color,
        position: "relative",
        zIndex: maxDepth - depthLevel
      });

      for (const childNode of node.children) {
        traverseDOM(childNode, depthLevel + 1);
      }
    }

    traverseDOM(element, 0);

    // Return cleanup function
    return () => {
      window.removeEventListener('scroll', updatePerspective);
      window.removeEventListener('resize', updatePerspective);
    };
  };

  // Set up mutation observer to watch for attribute
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      const element = mutation.target;
      if (element instanceof Element && element.hasAttribute("make-3d")) {
        make3D(element);
      }
    });
  });

  // Start observing the document
  observer.observe(document, {
    attributes: true,
    subtree: true,
    attributeFilter: ["make-3d"]
  });

  // Make global function available
  window.make3D = make3D;
})();