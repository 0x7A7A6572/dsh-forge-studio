/**
 * 分区的统一写操作通道：包住 busy / error、成功后重拉数据。
 * 实现只有一处（useSettingsSection.run），子页只当参数往下传。
 */
export type RunAction = (action: () => Promise<unknown>) => Promise<boolean>
