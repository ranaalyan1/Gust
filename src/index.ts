import { World, createSystem, Mesh, BoxGeometry, MeshNormalMaterial } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

class Smoke extends createSystem({}) {
  private m!: Mesh;
  init() {
    this.m = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), new MeshNormalMaterial());
    this.m.position.set(0, 1.2, -1);
    this.world.createTransformEntity(this.m);
    console.log('[smoke] init', this.world.xrEnabled, this.renderer.toneMapping, this.scene.background, this.scene.children.map(c=>c.type+':'+c.name).join(','));
  }
  update(d: number, t: number) { this.m.rotation.y = t; }
}

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(Smoke);
  (window as any).__world = world;
});
