// electron-builder hook: puts the THSC icon and name into the app's .exe (pure JavaScript, so the Windows
// app can be built on Linux or macOS without Wine).
const fs = require("node:fs");
const path = require("node:path");
const ResEdit = require("resedit");

exports.default = async function setExeIcon(context) {
  if (context.electronPlatformName !== "win32") return;
  const { productFilename } = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, "build", "icon.ico")));
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group ? group.id : 1, group ? group.lang : 1033, icon.icons.map((i) => i.data));
  const version = context.packager.appInfo.version;
  const info = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = version.split(".").map(Number);
  info.setFileVersion(a, b, c, 0, 1033);
  info.setProductVersion(a, b, c, 0, 1033);
  info.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: "THSC Summary Dashboard",
    FileDescription: "THSC Summary Dashboard",
    CompanyName: "The Heart Specialists Clinic",
    LegalCopyright: "The Heart Specialists Clinic",
    OriginalFilename: `${productFilename}.exe`,
    InternalName: productFilename,
  });
  info.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log("  • THSC icon and version info set on", path.basename(exePath));
};
