#include "gui_event_bus.h"

#include <QJsonDocument>
#include <QLocalSocket>

QString superpowerGuiEventServerName() {
  return QStringLiteral("superpower-local-agent-gui-v1");
}

bool publishGuiEvent(const QJsonObject& event, int timeoutMs) {
  QLocalSocket socket;
  socket.connectToServer(superpowerGuiEventServerName(), QIODevice::WriteOnly);
  if (!socket.waitForConnected(timeoutMs)) return false;

  QByteArray payload = QJsonDocument(event).toJson(QJsonDocument::Compact);
  payload.append('\n');
  if (socket.write(payload) != payload.size()) return false;
  if (!socket.waitForBytesWritten(timeoutMs)) return false;
  socket.disconnectFromServer();
  return true;
}
