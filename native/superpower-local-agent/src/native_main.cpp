#include <QCoreApplication>
#include <QDir>
#include <QString>

#include "agent_core.h"
#include "native_messaging.h"

int main(int argc, char* argv[]) {
  QCoreApplication app(argc, argv);
  QCoreApplication::setOrganizationName(QStringLiteral("Superpower"));
  QCoreApplication::setApplicationName(QStringLiteral("SuperpowerLocalAgent"));

  QString databasePath;
  const QStringList arguments = app.arguments();
  const qsizetype databaseIndex = arguments.indexOf(QStringLiteral("--database"));
  if (databaseIndex >= 0 && databaseIndex + 1 < arguments.size()) {
    databasePath = QDir::cleanPath(arguments.at(databaseIndex + 1));
  }

  AgentCore core(databasePath);
  QString error;
  if (!core.initialize(&error)) return 1;

  return runNativeMessagingHost(core);
}
