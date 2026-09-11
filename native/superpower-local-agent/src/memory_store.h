#pragma once

#include <QDateTime>
#include <QList>
#include <QSqlDatabase>
#include <QString>

struct LocationMemory {
  qint64 id = 0;
  QString alias;
  QString path;
  QString kind;
  QString note;
  qint64 useCount = 0;
  QDateTime lastUsedAt;
};

struct SearchRoot {
  qint64 id = 0;
  QString label;
  QString path;
  bool recursive = true;
};

class MemoryStore {
 public:
  explicit MemoryStore(QString databasePath = {});
  ~MemoryStore();

  MemoryStore(const MemoryStore&) = delete;
  MemoryStore& operator=(const MemoryStore&) = delete;

  bool open(QString* error = nullptr);
  bool isOpen() const;
  QString databasePath() const;

  bool rememberLocation(const QString& alias, const QString& path, const QString& note, QString* error = nullptr);
  bool forgetLocation(const QString& alias, QString* error = nullptr);
  bool touchLocation(qint64 id, QString* error = nullptr);

  std::optional<LocationMemory> findByAlias(const QString& alias, QString* error = nullptr) const;
  QList<LocationMemory> searchAliases(const QString& query, int limit = 20, QString* error = nullptr) const;
  QList<LocationMemory> listLocations(int limit = 100, QString* error = nullptr) const;

  bool addSearchRoot(const QString& path, const QString& label, bool recursive, QString* error = nullptr);
  bool removeSearchRoot(qint64 id, QString* error = nullptr);
  QList<SearchRoot> listSearchRoots(QString* error = nullptr) const;

 private:
  bool initializeSchema(QString* error);
  static QString normalizeExistingPath(const QString& path, QString* error);
  static LocationMemory readLocationRow(const QSqlQuery& query);

  QString connectionName_;
  QString databasePath_;
  QSqlDatabase database_;
};
