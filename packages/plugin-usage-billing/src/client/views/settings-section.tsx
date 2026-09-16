export function SettingsSection(props: { billing: unknown; scope: unknown }): JSX.Element {
  return (
    <section data-dsh-usage-billing>
      <h3>计费</h3>
      <div data-dsh-ub-sub>正在读取设置…</div>
    </section>
  )
}
