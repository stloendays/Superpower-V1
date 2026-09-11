#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonObject>
#include <QTemporaryDir>

#include <iostream>

#include "agent_core.h"

namespace {

bool require(bool condition, const char* message) {
  if (condition) return true;
  std::cerr << "FAIL: " << message << '\n';
  return false;
}

}  // namespace

int main(int argc, char* argv[]) {
  QCoreApplication app(argc, argv);
  QCoreApplication::setOrganizationName(QStringLiteral("SuperpowerTest"));
  QCoreApplication::setApplicationName(QStringLiteral("LocalAgentSmoke"));

  QTemporaryDir temp;
  if (!require(temp.isValid(), "temporary directory should be available")) return 1;

  const QString projectDir = temp.filePath(QStringLiteral("CatalystProject"));
  if (!require(QDir().mkpath(projectDir), "project directory should be created")) return 1;

  const QString reportPath = QDir(projectDir).filePath(QStringLiteral("stage2-report.txt"));
  QFile report(reportPath);
  if (!require(report.open(QIODevice::WriteOnly), "test file should open")) return 1;
  report.write("local agent smoke test\n");
  report.close();

  AgentCore core(temp.filePath(QStringLiteral("memory.sqlite3")));
  QString error;
  if (!require(core.initialize(&error), qPrintable(error))) return 1;

  const QJsonObject rememberResponse = core.handle(QJsonObject{
      {QStringLiteral("id"), QStringLiteral("remember")},
      {QStringLiteral("action"), QStringLiteral("memory.remember")},
      {QStringLiteral("args"), QJsonObject{{QStringLiteral("alias"), QStringLiteral("catalyst")},
                                           {QStringLiteral("path"), projectDir}}},
  });
  if (!require(rememberResponse.value(QStringLiteral("ok")).toBool(), "remember action should succeed")) return 1;

  const QJsonObject resolveResponse = core.handle(QJsonObject{
      {QStringLiteral("id"), QStringLiteral("resolve")},
      {QStringLiteral("action"), QStringLiteral("memory.resolve")},
      {QStringLiteral("args"), QJsonObject{{QStringLiteral("query"), QStringLiteral("catalyst")}}},
  });
  if (!require(resolveResponse.value(QStringLiteral("ok")).toBool(), "resolve action should succeed")) return 1;
  const QString resolvedPath =
      resolveResponse.value(QStringLiteral("result")).toObject().value(QStringLiteral("path")).toString();
  if (!require(QFileInfo(resolvedPath) == QFileInfo(projectDir), "remembered alias should resolve to the same path")) {
    return 1;
  }

  const QJsonObject rootResponse = core.handle(QJsonObject{
      {QStringLiteral("id"), QStringLiteral("root")},
      {QStringLiteral("action"), QStringLiteral("memory.add_root")},
      {QStringLiteral("args"), QJsonObject{{QStringLiteral("path"), projectDir},
                                           {QStringLiteral("recursive"), true}}},
  });
  if (!require(rootResponse.value(QStringLiteral("ok")).toBool(), "search root action should succeed")) return 1;

  const QJsonObject searchResponse = core.handle(QJsonObject{
      {QStringLiteral("id"), QStringLiteral("search")},
      {QStringLiteral("action"), QStringLiteral("file.search")},
      {QStringLiteral("args"), QJsonObject{{QStringLiteral("query"), QStringLiteral("stage2-report")},
                                           {QStringLiteral("max_results"), 10}}},
  });
  if (!require(searchResponse.value(QStringLiteral("ok")).toBool(), "search action should succeed")) return 1;
  const QJsonArray matches =
      searchResponse.value(QStringLiteral("result")).toObject().value(QStringLiteral("matches")).toArray();
  if (!require(!matches.isEmpty(), "approved-root search should find the test file")) return 1;

  const QJsonObject deniedOpen = core.handle(QJsonObject{
      {QStringLiteral("id"), QStringLiteral("open")},
      {QStringLiteral("action"), QStringLiteral("file.open")},
      {QStringLiteral("args"), QJsonObject{{QStringLiteral("query"), QStringLiteral("catalyst")}}},
  });
  if (!require(!deniedOpen.value(QStringLiteral("ok")).toBool(), "file.open should require approval")) return 1;
  const QJsonObject deniedError = deniedOpen.value(QStringLiteral("error")).toObject();
  if (!require(deniedError.value(QStringLiteral("confirmation_required")).toBool(),
               "open denial should be an approval request")) {
    return 1;
  }

  std::cout << "Superpower Local Agent core smoke test passed.\n";
  return 0;
}
