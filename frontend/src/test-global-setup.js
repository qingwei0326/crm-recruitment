// The product is used in China and tests assert CST wall-clock output
// (e.g. formatDateTime renders in the runtime's local timezone). Pin the
// timezone so results don't depend on the machine or CI runner (UTC).
export default function setup() {
  process.env.TZ = 'Asia/Shanghai';
}
