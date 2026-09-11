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
constexpr qsizetype kMaxGuiMessageChars = 16000;
constexpr qsizetype kMaxGuiMetadataChars = 120;

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

QJsonObject requestError(const QJsonObject& request, const QString& code, const QString& message) {
  QJsonObject response{{QStringLiteral("ok"), false},
                       {QStringLiteral("error"),
                        QJsonObject{{QStringLiteral("code"), code}, {QStringLiteral("message"), message}}}};
  if (request.contains(QStringLiteral("id"))) response.insert(QStringLiteral("id"), request.value(QStringLiteral("id")));
  return response;
}

QJsonObject requestSuccess(const QJsonObject& request, const QJsonObject& result) {
  QJsonObject response{{QStringLiteral("ok"), true}, {QStringLiteral("result"), result}};
  if (request.contains(QStringLiteral("id"))) response.insert(QStringLiteral("id"), request.value(QStringLiteral("id")));
  return response;
}

QString boundedMetadata(const QJsonObject& args, const QString& key, const QString& fallback) {
  QString value = args.value(key).toString().trimmed();
  if (value.isEmpty()) value = fallback;
  return value.left(kMaxGuiMetadataChars);
}

QJsonObject guiMessageEvent(const QJsonObject& request, QString* error) {
  const QJsonObject args = request.value(QStringLiteral("args")).toObject();
  const QString text = args.value(QStringLiteral("text")).toString();
  if (text.trimmed().isEmpty()) {
    if (error) *error = QStringLiteral("gui.notify requires non-empty args.text.");
    return {};
  }

  const bool truncated = text.size() > kMaxGuiMessageChars;
  QJsonObject event{{QStringLiteral("type"), QStringLiteral("local-agent.message")},
                    {QStringLiteral("role"), boundedMetadata(args, QStringLiteral("role"), QStringLiteral("Assistant"))},
                    {QStringLiteral("source"), boundedMetadata(args, QStringLiteral("source"), QStringLiteral("Browser"))},
                    {QStringLiteral("kind"), boundedMetadata(args, QStringLiteral("kind"), QStringLiteral("message"))},
                    {QStringLiteral("text"), text.left(kMaxGuiMessageChars)},
                    {QStringLiteral("truncated"), truncated}};
  if (request.contains(QStringLiteral("id"))) event.insert(QStringLiteral("id"), request.value(QStringLiteral("id")));
  return event;
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
    if (request.value(QStringLiteral("action")).toString() == QStringLiteral("gui.notify")) {
      QString notificationError;
      const QJsonObject event = guiMessageEvent(request, &notificationError);
      if (event.isEmpty()) {
        if (!writeFrame(requestError(request, QStringLiteral("invalid_args"), notificationError))) return 4;
        continue;
      }

      const bool delivered = publishGuiEvent(event, 120);
      const QJsonObject response = requestSuccess(
          request, QJsonObject{{QStringLiteral("delivered"), delivered},
                               {QStringLiteral("ephemeral"), true},
                               {QStringLiteral("persisted"), false},
                               {QStringLiteral("truncated"), event.value(QStringLiteral("truncated"))}});
      if (!writeFrame(response)) return 4;
      continue;
    }

    const QJsonObject response = core.handle(request);
    publishGuiEvent(activityEvent(request, response));
    if (!writeFrame(response)) return 4;
  }
}
