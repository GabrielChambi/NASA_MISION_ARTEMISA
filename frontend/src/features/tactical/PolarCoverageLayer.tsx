import {useEffect,useMemo} from 'react'
import * as THREE from 'three'
import type {PolarSurface} from './polarScience'
import {coverageRaster,type PolarCoverage} from './polarCoverage'

export type {PolarCoverage} from './polarCoverage'

// A 128 x 128 nearest-neighbor classification texture covers the ENTIRE exact
// NASA terrain mesh. Height/albedo never determines class; scientific cell IDs do.
// The geometry is borrowed from Terrain, including its nodata holes and clipping.

const VERTEX=`
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 coveragePosition;
void main(){
  coveragePosition=position;
  vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
  gl_Position=projectionMatrix*mvPosition;
  #include <clipping_planes_vertex>
}
`
const FRAGMENT=`
#include <common>
#include <clipping_planes_pars_fragment>
uniform sampler2D coverageTexture;
uniform float gridSize;
uniform float spacingM;
uniform vec2 gridOrigin;
uniform float radiusM;
uniform float capRadiusM;
uniform float opacityScale;
uniform vec2 selectedCell;
uniform vec3 greenColor;
uniform vec3 yellowColor;
uniform vec3 redColor;
uniform vec3 unknownColor;
varying vec3 coveragePosition;
float sampleCode(vec2 index){
  if(any(lessThan(index,vec2(0.0)))||any(greaterThanEqual(index,vec2(gridSize))))return 4.0;
  return floor(texture2D(coverageTexture,(index+vec2(0.5))/gridSize).r*255.0+0.5);
}
void main(){
  #include <clipping_planes_fragment>
  vec3 radial=coveragePosition+vec3(0.0,radiusM/1000.0,0.0);
  float denominator=length(radial)+radial.y;
  if(denominator<=0.0)discard;
  vec2 stereo=vec2(-radial.x,radial.z)*(2.0*radiusM/denominator);
  if(length(stereo)>capRadiusM)discard;
  vec2 coord=vec2((stereo.x-gridOrigin.x)/spacingM,(gridOrigin.y-stereo.y)/spacingM);
  if(any(lessThan(coord,vec2(0.0)))||any(greaterThanEqual(coord,vec2(gridSize))))discard;
  vec2 index=floor(coord),within=fract(coord);
  float code=sampleCode(index);
  vec3 color=unknownColor;
  float fill=0.17;
  if(code<1.5){color=greenColor;fill=0.43;}
  else if(code<2.5){color=yellowColor;fill=0.31;}
  else if(code<3.5){color=redColor;fill=0.16;}
  vec2 width=clamp(fwidth(coord)*1.35,vec2(0.004),vec2(0.18));
  float left=(1.0-smoothstep(0.0,width.x,within.x))*step(0.5,abs(code-sampleCode(index-vec2(1.0,0.0))));
  float right=(1.0-smoothstep(0.0,width.x,1.0-within.x))*step(0.5,abs(code-sampleCode(index+vec2(1.0,0.0))));
  float top=(1.0-smoothstep(0.0,width.y,within.y))*step(0.5,abs(code-sampleCode(index-vec2(0.0,1.0))));
  float bottom=(1.0-smoothstep(0.0,width.y,1.0-within.y))*step(0.5,abs(code-sampleCode(index+vec2(0.0,1.0))));
  float edge=max(max(left,right),max(top,bottom));
  if(code>3.5)fill*=mix(0.50,1.0,step(1.0,mod(floor(gl_FragCoord.x/3.0)+floor(gl_FragCoord.y/3.0),2.0)));
  float alpha=mix(fill,0.82,edge)*opacityScale;
  if(all(lessThan(abs(index-selectedCell),vec2(0.25)))){
    float selectedEdge=max(max(1.0-smoothstep(0.0,width.x*1.65,within.x),1.0-smoothstep(0.0,width.x*1.65,1.0-within.x)),max(1.0-smoothstep(0.0,width.y*1.65,within.y),1.0-smoothstep(0.0,width.y*1.65,1.0-within.y)));
    color=mix(color,vec3(1.0),selectedEdge);
    alpha=max(alpha,selectedEdge*0.96);
  }
  gl_FragColor=vec4(color,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function PolarCoverageLayer({geometry,surface,coverage,clippingPlanes,clipIntersection=true}:{
  geometry:THREE.BufferGeometry
  surface:PolarSurface
  coverage:PolarCoverage
  clippingPlanes?:THREE.Plane[]
  clipIntersection?:boolean
}){
  const texture=useMemo(()=>{
    const texture=new THREE.DataTexture(coverageRaster(surface,coverage.cells),surface.grid_size,surface.grid_size,THREE.RedFormat,THREE.UnsignedByteType)
    texture.minFilter=THREE.NearestFilter;texture.magFilter=THREE.NearestFilter
    texture.flipY=false;texture.generateMipmaps=false;texture.unpackAlignment=1
    texture.needsUpdate=true
    return texture
  },[surface,coverage.cells])
  const material=useMemo(()=>new THREE.ShaderMaterial({
    vertexShader:VERTEX,fragmentShader:FRAGMENT,transparent:true,depthWrite:false,
    depthTest:true,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,
    side:THREE.DoubleSide,clipping:true,clippingPlanes:clippingPlanes??[],clipIntersection,
    uniforms:{
      coverageTexture:{value:texture},gridSize:{value:surface.grid_size},spacingM:{value:surface.cell_spacing_m},
      gridOrigin:{value:new THREE.Vector2(surface.grid.xmin,surface.grid.ymax)},
      radiusM:{value:surface.radius_m},capRadiusM:{value:2*surface.radius_m*Math.tan(5*Math.PI/180)},
      opacityScale:{value:1},selectedCell:{value:new THREE.Vector2(-1,-1)},
      greenColor:{value:new THREE.Color('#55efa4')},yellowColor:{value:new THREE.Color('#ffdb75')},
      redColor:{value:new THREE.Color('#ef6973')},unknownColor:{value:new THREE.Color('#b8c2ce')}
    }
  }),[texture,surface,clippingPlanes,clipIntersection])
  useEffect(()=>()=>{material.dispose()},[material])
  useEffect(()=>()=>{texture.dispose()},[texture])
  useEffect(()=>{
    const cell=surface.cells.find(cell=>cell.id===coverage.selectedId)
    material.uniforms.selectedCell.value.set(cell?.col??-1,cell?.row??-1)
    material.uniforms.opacityScale.value=THREE.MathUtils.clamp(coverage.opacity??1,0,1)
  },[material,surface,coverage.selectedId,coverage.opacity])
  return <mesh name="whole-cap-classification" geometry={geometry} renderOrder={6} raycast={()=>null} dispose={null}
    userData={{analysis:'regional-result-raster',cells:coverage.cells.length,grid_size:surface.grid_size}}>
    <primitive attach="material" object={material}/>
  </mesh>
}
