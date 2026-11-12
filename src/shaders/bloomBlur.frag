precision highp float;

uniform sampler2D tMap;
uniform vec2 uDirection;
uniform vec2 uTexelSize;

varying vec2 vUv;

void main() {
  vec2 off1 = vec2(1.411764705882353) * uDirection * uTexelSize;
  vec2 off2 = vec2(3.2941176470588234) * uDirection * uTexelSize;
  vec2 off3 = vec2(5.176470588235294) * uDirection * uTexelSize;
  vec2 off4 = vec2(7.5) * uDirection * uTexelSize;

  vec3 color = texture2D(tMap, vUv).rgb * 0.1964825501511404;
  color += texture2D(tMap, vUv + off1).rgb * 0.2769069646728344;
  color += texture2D(tMap, vUv - off1).rgb * 0.2769069646728344;
  color += texture2D(tMap, vUv + off2).rgb * 0.09447039785044732;
  color += texture2D(tMap, vUv - off2).rgb * 0.09447039785044732;
  color += texture2D(tMap, vUv + off3).rgb * 0.02538156125120025;
  color += texture2D(tMap, vUv - off3).rgb * 0.02538156125120025;
  color += texture2D(tMap, vUv + off4).rgb * 0.005;
  color += texture2D(tMap, vUv - off4).rgb * 0.005;

  gl_FragColor = vec4(color, 1.0);
}
