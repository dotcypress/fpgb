<script>
  import { SVG } from "@svgdotjs/svg.js";
  import BB from "./../svg/breadboard.svg";

  function breadboard(node) {
    const draw = SVG()
      .addTo(node)
      .size("100%", "100%");
    draw.on("mouseover mouseout", ev => {
      const parent = ev.target.parentNode;
      if (parent.dataset && parent.dataset.pin) {
        console.log("pin", parent.dataset.pin);
      }
    });
    draw.svg(BB);
  }
</script>

<style>
  #canvas {
    height: 350px;
    margin: 32px;
  }
</style>

<div>
  <div id="canvas" use:breadboard />
</div>
