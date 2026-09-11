#pragma once

#include <QJsonObject>
#include <QString>

#include "file_locator.h"
#include "memory_store.h"

class AgentCore {
 public:
  explicit AgentCore(QString databasePath = {});

  bool initialize(QString* error = nullptr);
  QJsonObject handle(const QJsonObject& request);
  MemoryStore& memoryStore();

 private:
  QJsonObject handleCapabilities(const QJsonObject& request) const;
  QJsonObject handleRemember(const QJsonObject& request);
  QJsonObject handleForget(const QJsonObject& request);
  QJsonObject handleResolve(const QJsonObject& request);
  QJsonObject handleList(const QJsonObject& request) const;
  QJsonObject handleAddRoot(const QJsonObject& request);
  QJsonObject handleListRoots(const QJsonObject& request) const;
  QJsonObject handleSearch(const QJsonObject& request) const;
  QJsonObject handleOpen(const QJsonObject& request);

  static QJsonObject success(const QJsonObject& request, const QJsonValue& result = QJsonObject{});
  static QJsonObject failure(const QJsonObject& request, const QString& code, const QString& message,
                             bool confirmationRequired = false);
  static QJsonObject locationToJson(const LocationMemory& memory);
  static QJsonObject locatedPathToJson(const LocatedPath& located);
  static QJsonObject rootToJson(const SearchRoot& root);

  MemoryStore memoryStore_;
  FileLocator fileLocator_;
};
