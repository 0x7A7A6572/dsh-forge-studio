/**
 * 场景注册表（§6.4）：只放内置场景；选择逻辑在 studio-model。
 */
import type { StudioSceneId, StudioSceneRegistry } from './scene-types.ts'
import { OFFICE_SCENE } from './scene-office.ts'

export const DEFAULT_SCENE_ID: StudioSceneId = 'office'

/** 内置注册表：其他场景 id 留位，回退场景（forge）按 §6.7.6 再启用。 */
export const STUDIO_SCENE_REGISTRY: StudioSceneRegistry = {
  defaultSceneId: DEFAULT_SCENE_ID,
  scenes: { office: OFFICE_SCENE },
}
