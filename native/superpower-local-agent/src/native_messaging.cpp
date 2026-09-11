#include "native_messaging.h"

#include <QJsonDocument>
#include <QJsonObject>

#include <array>
#include <cstdint>
#include <iostream>
#include <string>

#ifdef Q_OS_WIN
#include <fcntl.h>
#include <io.h>
#endif

#include "agent_core.h"
#include "gui_event_bus.h"

namespace {

constexpr std::uint32_t kMaxIncomingMessageBytes = 1024U * 1024U;

void configureBinaryStdio() {
#ifdef Q_OS_WIN
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
}

bool readFrame(QByteArray* payload, bool* eof, QString* error) {
  *eof = false;
  std::array<unsigned char, 4> header{};
  std::cin.read(reinterpret_cast<char*>(header.data()), static_cast<std::streamsize>(header.size()));
  const std::streamsize headerBytes = std::cin.gcount();
  if (headerBytes == 0 && std::cin.eof()) {
    *eof = true;
    return false;
  }
  if (headerBytes != static_cast<std::streamsize>(header.size())) {
    if (error) *error = QStringLiteral("Native Messaging frame ended before its 4-byte length header was complete.");
    return false;
  }

  const std::uint32_t length = static_cast<std::uint32_t>(header[0]) |
                               (static_cast<std::uint32_t>(header[1]) << 8U) |
                               (static_cast<std::uint32_t>(header[2]) << 16U) |
                               (static_cast<std::uint32_t>(header[3]) << 24U);
  if (length == 0 || length > kMaxIncomingMessageBytes) {
    if (error) *error = QStringLiteral("Native Messaging message length is invalid or exceeds the 1 MiB safety limit.");
    return false;
  }

  std::string buffer(length, '\0');
  std::cin.read(buffer.data(), static_cast<std::streamsize>(length));
  if (std::cin.gcount() != static_cast<std::streamsize>(length)) {
    if (error) *error = QStringLiteral("Native Messaging payload ended before the declared frame length.");
    return false;
  }

  *payload = QByteArray(buffer.data(), static_cast<qsizetype>(length));
  return true;
}

bool writeFrame(const QJsonObject& response) {
  const QByteArray payload = QJsonDocument(response).toJson(QJsonDocument::Compact);
  const std::uint32_t length = static_cast<std::uint32_t>(payload.size());
  const std::array<unsigned char, 4> header{
      static_cast<unsigned char>(length & 0xFFU),
      static_cast<unsigned char>((length >> 8U) & 0xFFU),
      static_cast<unsigned char>((length >> 16U) & 0xFFU),
      static_cast<unsigned char>((length >> 24U) & 0xFFU),
  };

  std::cout.write(reinterpret_cast<const char*>(header.data()), static_cast<std::streamsize>(header.size()));
  std::cout.write(payload.constData(), static_cast<std::streamsize>(payload.size()));
  std::cout.flush();
  return std::cout.good();
}

QJsonObject protocolError(const QString& message) {
  return QJsonObject{{QStringLiteral("ok"), false},
                     {QStringLiteral("error"),
                      QJsonObject{{QStringLiteral("code"), QStringLiteral("protocol_error")},
                                  {QStringLiteral("message"), message}}}};
}

QJsonObject activityEvent(const QJsonObject& request, const QJsonObject& response) {
  QJsonObject event{{QStringLiteral("type"), QStringLiteral("local-agent.activity")},
                    {QStringLiteral("action"), request.value(QStringLiteral("action")).toString()},
                    {QStringLiteral("ok"), response.value(QStringLiteral("ok")).toBool(false)}};
  if (request.contains(QStringLiteral("id"))) event.insert(QStringLiteral("id"), request.value(QStringLiteral("id")));

  const QJsonObject result = response.value(QStringLiteral("result")).toObject();
  if (result.contains(QStringLiteral("path"))) event.insert(QStringLiteral("path"), result.value(QStringLiteral("path")));
  if (!response.value(QStringLiteral("ok")).toBool(false)) {
    const QJsonObject error = response.value(QStringLiteral("error")).toObject();
    event.insert(QStringLiteral("message"), error.value(QStringLiteral("message")).toString());
  }
  return event;
}

}  // namespace

int runNativeMessagingHost(AgentCore& core) {
  configureBinaryStdio();

  while (true) {
    QByteArray payload;
    bool eof = false;
    QString frameError;
    if (!readFrame(&payload, &eof, &frameError)) {
      if (eof) return 0;
      writeFrame(protocolError(frameError));
      return 2;
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(payload, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
      if (!writeFrame(protocolError(QStringLiteral("Request must be a JSON object: %1").arg(parseError.errorString())))) {
        return 3;
      }
      continue;
    }

    const QJsonObject request = document.object();
    const QJsonObject response = core.handle(request);
    publishGuiEvent(activityEvent(request, response));
    if (!writeFrame(response)) return 4;
  }
}
