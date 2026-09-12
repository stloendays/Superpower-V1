#include <QApplication>
#include <QMessageBox>
#include <QString>

#include "agent_core.h"
#include "main_window.h"

int main(int argc, char* argv[]) {
  QApplication app(argc, argv);
  QApplication::setOrganizationName(QStringLiteral("Superpower"));
  QApplication::setApplicationName(QStringLiteral("SuperpowerLocalAgent"));
  QApplication::setApplicationDisplayName(QStringLiteral("Superpower Local Agent"));

  AgentCore core;
  QString error;
  if (!core.initialize(&error)) {
    QMessageBox::critical(nullptr, QStringLiteral("Superpower Local Agent"),
                          QStringLiteral("Local memory could not be opened:\n%1").arg(error));
    return 1;
  }

  MainWindow window(core);
  window.show();
  return app.exec();
}
