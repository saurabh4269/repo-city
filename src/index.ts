import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { RepoCityDirector } from './director.js';
import { XrPerfSystem } from './xr-perf.js';
import { setupPage } from './page.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(XrPerfSystem);
  world.registerSystem(RepoCityDirector);
  setupPage(world);
});
